// /api/deployments/<siteId>/verify — 배포 후 검증 실행 (Phase 15)
//
// 배포 완료 신호만으로 성공 처리하지 않고, 실제 URL을 검사해
// success / partial_success / failed 를 확정합니다.
// production/replace 성공 시 stage → operating (preview는 stage 변경 없음).

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getDeployJob, transitionDeployJob, lastSuccessfulDeploy } from '../../../_lib/deploy-repository.js'
import { verifyDeployment } from '../../../_lib/deploy-verify.js'
import { nextStageForDeploy, DEPLOY_ERROR_GUIDES } from '../../../_lib/deploy-status.js'
import { setOnboardingStage } from '../../../_lib/onboarding-repository.js'
import { resolveDeploySite } from '../[site].js'

const VERIFIABLE = ['building', 'deploying', 'verifying', 'failed', 'partial_success']

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 5_000)
  const id = String(body?.id ?? '')
  if (!/^dep_[a-f0-9-]{36}$/.test(id)) return jsonResponse({ ok: false, error: '배포 id가 올바르지 않습니다.' }, 400)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  try {
    const job = await getDeployJob(db, id)
    if (!job || job.siteId !== resolved.siteId) {
      return jsonResponse({ ok: false, error: '해당 사이트의 배포 기록을 찾을 수 없습니다.' }, 404)
    }
    if (!VERIFIABLE.includes(job.status)) {
      return jsonResponse({ ok: false, error: `현재 상태(${job.status})에서는 검증할 수 없습니다.` }, 400)
    }

    // 검증 대상 결정: preview → pages.dev / production·replace → 대상 도메인
    const isPreview = job.deploymentType === 'preview'
    let host = ''
    if (isPreview) {
      try { host = new URL(job.previewUrl).hostname } catch { host = '' }
      if (host === '' && job.pagesProject !== '') host = `${job.pagesProject}.pages.dev`
    } else {
      host = job.targetDomain
    }
    if (host === '') {
      return jsonResponse({ ok: false, error: '검증할 대상 URL이 없습니다. 배포 설정(Pages 프로젝트/도메인)을 확인해 주세요.' }, 400)
    }

    const expectedName = job.preflightResult?.plan?.hospitalName ?? resolved.onboarding?.hospitalName ?? ''
    const result = await verifyDeployment(context.env, {
      host, expectedName, expectedCanonicalHost: job.targetDomain, isPreview,
    })

    const wrongSite = result.checks.some((check) => check.key === 'site-identity' && check.status === 'fail')
    const now = new Date().toISOString()
    const updated = await transitionDeployJob(db, id, VERIFIABLE, result.status, {
      verificationResult: { checks: result.checks, finalUrl: result.finalUrl, verifiedAt: now },
      completedAt: now,
      errorCode: result.status === 'failed' ? (wrongSite ? 'wrong_site' : 'verify_failed') : '',
      errorMessage: result.status === 'failed' ? DEPLOY_ERROR_GUIDES[wrongSite ? 'wrong_site' : 'verify_failed'] : '',
      productionUrl: !isPreview && result.status !== 'failed' ? `https://${job.targetDomain}` : job.productionUrl,
    })

    // stage 전이 (서버 한 곳에서만)
    const hadSuccessBefore = !!(await lastSuccessfulDeploy(db, resolved.siteId, id))
    const nextStage = nextStageForDeploy({
      event: result.status === 'success' ? 'verified_success' : result.status === 'failed' ? 'failed' : 'none',
      deploymentType: job.deploymentType,
      currentStage: resolved.onboarding?.stage ?? 'onboarding',
      hadSuccessBefore,
    })
    if (nextStage) await setOnboardingStage(db, resolved.siteId, nextStage).catch(() => {})

    return jsonResponse({ ok: true, job: updated ?? job, verification: result })
  } catch (e) {
    console.error(`[배포 검증] 실패 site=${resolved.siteId} id=${id}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
