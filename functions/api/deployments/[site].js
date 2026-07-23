// /api/deployments/<siteId> — 배포 요약·이력(GET) / 배포 생성(POST) / 배포 설정(PUT) (Phase 15)
//
// - 관리자 인증 필수
// - 승인 조건은 서버에서 재검증 (UI 체크만 믿지 않음)
// - 사전 검사(fail 존재 시 Production/Replace 차단)·readiness 재확인 후에만 실행
// - 동시 중복 배포 409 · 강제 push 없음 · 기존 배포 구조(push → Pages 자동 빌드) 유지
// - Cloudflare API Token 없으면 수동 배포 안내(Manual Mode)로 기록

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { getOnboarding, setOnboardingStage } from '../../_lib/onboarding-repository.js'
import { DEPLOYMENT_TYPES, DEPLOY_STATUS_LABELS, DEPLOY_ERROR_GUIDES, nextStageForDeploy } from '../../_lib/deploy-status.js'
import { runPreflight, getBranchHeadSha } from '../../_lib/deploy-preflight.js'
import {
  insertDeployJob, findActiveDeploy, listDeploysForSite, lastSuccessfulDeploy,
  getDeployConfig, upsertDeployConfig, resolveDeployConfig,
} from '../../_lib/deploy-repository.js'
import { hasCloudflareApi, createPagesDeployment } from '../../_lib/cloudflare-pages.js'

const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const NAME_PATTERN = /^[a-zA-Z0-9._/-]{0,80}$/

export async function resolveDeploySite(db, site) {
  const siteId = String(site ?? '')
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length > 30) return { error: 'siteId가 올바르지 않습니다.', status: 400 }
  const onboarding = await getOnboarding(db, siteId).catch(() => null)
  if (!ALLOWED_SITES.includes(siteId) && !onboarding) {
    return { error: `등록되지 않은 사이트입니다: "${siteId}"`, status: 404 }
  }
  return { siteId, onboarding }
}

export function errorResponse(code, extra = {}, status = 400) {
  return jsonResponse({ ok: false, errorCode: code, error: DEPLOY_ERROR_GUIDES[code] ?? code, ...extra }, status)
}

// ---------- GET: 요약 + 이력 ----------
export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  try {
    const [active, history, lastSuccess, storedConfig] = await Promise.all([
      findActiveDeploy(db, resolved.siteId),
      listDeploysForSite(db, resolved.siteId, 10),
      lastSuccessfulDeploy(db, resolved.siteId),
      getDeployConfig(db, resolved.siteId),
    ])
    const config = resolveDeployConfig(context.env, resolved.siteId, storedConfig)
    return jsonResponse({
      ok: true,
      site: resolved.siteId,
      stage: resolved.onboarding?.stage ?? 'onboarding',
      hospitalName: resolved.onboarding?.hospitalName ?? resolved.siteId,
      operationMode: resolved.onboarding?.operationMode ?? 'independent',
      activeDeploy: active,
      history,
      lastSuccess: lastSuccess
        ? { id: lastSuccess.id, completedAt: lastSuccess.completedAt, gitCommitSha: lastSuccess.gitCommitSha, productionUrl: lastSuccess.productionUrl, pagesDeploymentId: lastSuccess.pagesDeploymentId }
        : null,
      config,
      configStored: !!storedConfig,
      apiMode: hasCloudflareApi(context.env),
      statusLabels: DEPLOY_STATUS_LABELS,
      previewHost: config.pagesProject ? `${config.pagesProject}.pages.dev` : '',
    })
  } catch (e) {
    console.error(`[배포 조회] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 정보를 불러오지 못했습니다. (0008 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

// ---------- POST: 배포 생성 ----------
export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 20_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const type = String(body.type ?? '')
  if (!DEPLOYMENT_TYPES.includes(type)) {
    return jsonResponse({ ok: false, error: `배포 유형은 ${DEPLOYMENT_TYPES.join('/')} 중 하나여야 합니다.` }, 400)
  }

  try {
    // 1) 중복 배포 차단
    const active = await findActiveDeploy(db, resolved.siteId)
    if (active) return errorResponse('duplicate_deploy', { activeDeploy: { id: active.id, status: active.status } }, 409)

    // 2) 사전 검사 + readiness 재확인 (서버 재검증 — UI 결과를 믿지 않음)
    const preflight = await runPreflight(context.env, db, resolved.siteId, type)
    if (!preflight.summary.canDeploy) {
      return errorResponse(
        type === 'production' || type === 'replace'
          ? (preflight.checks.find((check) => check.key === 'domain-readiness' && check.status === 'fail') ? 'domain_not_ready' : 'preflight_failed')
          : 'preflight_failed',
        { checks: preflight.checks, summary: preflight.summary }
      )
    }
    const operationMode = preflight.plan.operationMode

    // 3) 승인 조건 서버 재검증
    const approvedBy = String(body.approvedBy ?? '').trim().slice(0, 40)
    const approvals = body.approvals && typeof body.approvals === 'object' ? body.approvals : {}
    if (type === 'production') {
      if (operationMode === 'replace') {
        return errorResponse('replace_not_approved', { error: '이 사이트는 기존 홈페이지 교체(replace) 모드입니다. [Replace 배포]로 진행해 주세요.' })
      }
      if (approvals.productionConfirmed !== true || approvedBy === '') {
        return jsonResponse({ ok: false, error: 'Production 배포는 "대상 도메인에 실제 반영됩니다" 확인과 승인자 이름이 필요합니다.' }, 400)
      }
    }
    if (type === 'replace') {
      if (operationMode !== 'replace') {
        return jsonResponse({ ok: false, error: '이 사이트는 교체(replace) 모드가 아닙니다. [Production 배포]로 진행해 주세요.' }, 400)
      }
      const required = ['hospitalApproved', 'dnsBackupConfirmed', 'scheduleConfirmed', 'rollbackUnderstood', 'downtimeUnderstood']
      const missing = required.filter((key) => approvals[key] !== true)
      if (missing.length > 0 || approvedBy === '') {
        return errorResponse('replace_not_approved', { missingApprovals: missing })
      }
      const confirmText = String(body.confirmText ?? '').trim().toLowerCase()
      if (confirmText !== preflight.plan.targetDomain.toLowerCase()) {
        return jsonResponse({ ok: false, error: `최종 확인을 위해 대상 도메인(${preflight.plan.targetDomain})을 정확히 입력해 주세요.` }, 400)
      }
    }

    // 4) 배포 설정·커밋 정보
    const storedConfig = await getDeployConfig(db, resolved.siteId)
    const config = resolveDeployConfig(context.env, resolved.siteId, storedConfig)
    const branch = type === 'preview' ? config.gitBranch : config.productionBranch
    const commitSha = await getBranchHeadSha(context.env, branch)

    // 5) 배포 트리거 (API Mode) 또는 수동 안내 (Manual Mode)
    const id = `dep_${crypto.randomUUID()}`
    const now = new Date().toISOString()
    let status = 'building'
    let pagesDeploymentId = ''
    let previewUrl = config.pagesProject ? `https://${config.pagesProject}.pages.dev` : ''
    let deploymentResult
    if (hasCloudflareApi(context.env)) {
      const triggered = await createPagesDeployment(context.env, { project: config.pagesProject, branch })
      if (!triggered.ok) {
        return errorResponse(triggered.code === 'no_cf_token' ? 'no_cf_token' : triggered.code === 'cf_permission' ? 'cf_permission' : triggered.code === 'pages_project_missing' ? 'pages_project_missing' : 'pages_build_failed', { detail: triggered.error }, 502)
      }
      pagesDeploymentId = triggered.deployment?.id ?? ''
      if (triggered.deployment?.url) previewUrl = triggered.deployment.url
      deploymentResult = { mode: 'api', triggeredAt: now, branch, note: 'Cloudflare Pages 빌드를 트리거했습니다. [상태 새로고침]으로 진행 상황을 확인하세요.' }
    } else {
      deploymentResult = {
        mode: 'manual', branch,
        note: 'Cloudflare API Token이 없어 자동 트리거하지 않았습니다. git push(자동 빌드) 또는 Cloudflare Dashboard의 재배포 실행 후, 빌드 완료(1~2분)를 기다려 [배포 후 검증]을 실행해 주세요.',
      }
    }

    const job = await insertDeployJob(db, {
      id, siteId: resolved.siteId, deploymentType: type, status,
      targetDomain: preflight.plan.targetDomain, operationMode,
      gitBranch: branch, gitCommitSha: commitSha,
      pagesProject: config.pagesProject, pagesDeploymentId, previewUrl,
      productionUrl: preflight.plan.targetDomain ? `https://${preflight.plan.targetDomain}` : '',
      preflightResult: { checks: preflight.checks, summary: preflight.summary, plan: preflight.plan },
      deploymentResult,
      approvedBy, approvedAt: approvedBy ? now : null,
    })

    // 6) stage 전이 (production/replace 시작 → deploy)
    const nextStage = nextStageForDeploy({
      event: 'started', deploymentType: type,
      currentStage: resolved.onboarding?.stage ?? 'onboarding',
      hadSuccessBefore: !!(await lastSuccessfulDeploy(db, resolved.siteId, id)),
    })
    if (nextStage) await setOnboardingStage(db, resolved.siteId, nextStage).catch(() => {})

    return jsonResponse({ ok: true, job, manualMode: deploymentResult.mode === 'manual' })
  } catch (e) {
    console.error(`[배포 생성] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 생성 중 오류가 발생했습니다. (0008 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

// ---------- PUT: 사이트별 배포 설정 (수동 프로젝트 연결) ----------
export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 10_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const fields = {}
  for (const key of ['pagesProject', 'gitBranch', 'productionBranch', 'buildCommand', 'outputDirectory']) {
    const value = String(body[key] ?? '').trim()
    if (!NAME_PATTERN.test(value)) return jsonResponse({ ok: false, error: `${key} 값에 허용되지 않는 문자가 있습니다.` }, 400)
    fields[key] = value
  }
  fields.deploymentStrategy = body.deploymentStrategy === 'isolated' ? 'isolated' : 'shared'

  try {
    const stored = await upsertDeployConfig(db, resolved.siteId, fields)
    return jsonResponse({ ok: true, config: resolveDeployConfig(context.env, resolved.siteId, stored), configStored: true })
  } catch (e) {
    console.error(`[배포 설정] 저장 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 설정을 저장하지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
