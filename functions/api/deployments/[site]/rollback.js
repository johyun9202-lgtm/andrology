// /api/deployments/<siteId>/rollback — 이전 성공 배포로 복구 (Phase 15)
//
// 보수적 정책: 자동 rollback 없음 — 사용자가 사유를 입력하고 명시적으로 실행할
// 때만 Cloudflare Pages rollback API를 호출합니다. API Token이 없으면 실행하지
// 않고 이전 버전 정보 + 수동 복구 절차를 안내합니다(executed=false).
// replace 모드는 DNS 복구 정보(기존 레코드 백업 메모)도 함께 반환합니다.

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getDeployJob, transitionDeployJob, lastSuccessfulDeploy } from '../../../_lib/deploy-repository.js'
import { hasCloudflareApi, rollbackPagesDeployment } from '../../../_lib/cloudflare-pages.js'
import { getActiveConnection } from '../../../_lib/domain-repository.js'
import { resolveDeploySite, errorResponse } from '../[site].js'

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
    if (!['failed', 'partial_success', 'success'].includes(job.status)) {
      return jsonResponse({ ok: false, error: `진행 중인 배포(${job.status})는 되돌릴 수 없습니다. 완료 후 다시 시도해 주세요.` }, 400)
    }

    // 되돌릴 이전 성공 배포
    const previous = await lastSuccessfulDeploy(db, resolved.siteId, id)
    const connection = await getActiveConnection(db, resolved.siteId).catch(() => null)
    const rollbackInfo = {
      previousDeploy: previous
        ? { id: previous.id, completedAt: previous.completedAt, gitCommitSha: previous.gitCommitSha, pagesDeploymentId: previous.pagesDeploymentId, url: previous.productionUrl || previous.previewUrl }
        : null,
      replaceRecovery: job.operationMode === 'replace'
        ? {
            previousSiteUrl: resolved.onboarding?.existingUrl ?? '',
            dnsBackupNote: connection?.notes ?? '',
            steps: [
              '1) DNS 관리 화면에서 전환 전 기록해 둔 기존 레코드(Type/Name/Value)로 되돌립니다.',
              '2) TTL에 따라 수 분~수 시간 내 기존 홈페이지가 복구됩니다.',
              '3) 복구 후 도메인 탭 [검증 실행]으로 상태를 확인합니다.',
            ],
          }
        : null,
      manualSteps: [
        'Cloudflare Dashboard → Pages → 프로젝트 → Deployments에서 이전 성공 배포의 [Rollback] 실행',
        previous?.gitCommitSha ? `또는 git에서 이전 커밋(${previous.gitCommitSha.slice(0, 7)})으로 revert 커밋 후 push` : 'git revert 커밋 후 push',
      ],
    }

    if (!previous) {
      return errorResponse('rollback_unavailable', { executed: false, rollbackInfo })
    }

    // 실행 조건: 명시적 confirm + 사유
    const reason = String(body.reason ?? '').trim().slice(0, 200)
    if (body.confirm !== true || reason === '') {
      return jsonResponse({ ok: false, executed: false, rollbackInfo, error: 'rollback 실행에는 확인(confirm)과 사유 입력이 필요합니다.' }, 400)
    }

    // API Mode가 아니거나 이전 배포의 Pages id가 없으면 수동 안내만
    if (!hasCloudflareApi(context.env) || previous.pagesDeploymentId === '') {
      return jsonResponse({
        ok: true, executed: false, rollbackInfo,
        note: 'API Token 또는 이전 배포의 Pages 기록이 없어 자동 rollback을 실행하지 않았습니다. 수동 복구 절차를 따라 주세요.',
      })
    }

    const result = await rollbackPagesDeployment(context.env, { project: previous.pagesProject || job.pagesProject, deploymentId: previous.pagesDeploymentId })
    if (!result.ok) {
      return jsonResponse({ ok: false, executed: false, rollbackInfo, error: result.error }, 502)
    }

    const updated = await transitionDeployJob(db, id, ['failed', 'partial_success', 'success'], 'rolled_back', {
      rollbackSourceId: previous.id,
      rollbackReason: reason,
      completedAt: new Date().toISOString(),
    })

    return jsonResponse({
      ok: true, executed: true, job: updated ?? job, rollbackInfo,
      note: `이전 성공 배포(${previous.id.slice(0, 12)}…)로 되돌렸습니다. 반영 후 [배포 후 검증]으로 상태를 확인해 주세요.`,
    })
  } catch (e) {
    console.error(`[롤백] 실패 site=${resolved.siteId} id=${id}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '롤백 처리 중 오류가 발생했습니다. 수동 복구 절차를 확인해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
