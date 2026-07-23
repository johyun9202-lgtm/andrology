// /api/deployments/<siteId>/status?id= — 배포 상태 새로고침 (Phase 15)
//
// API Mode: Cloudflare Pages 배포 상태를 조회해 building → deploying → verifying
// (또는 failed)로 전이합니다. Manual Mode: 기록된 상태를 그대로 반환합니다.
// "배포 완료"가 되어도 success로 바꾸지 않습니다 — 검증(verify)을 거쳐야 합니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getDeployJob, transitionDeployJob } from '../../../_lib/deploy-repository.js'
import { hasCloudflareApi, getPagesDeployment } from '../../../_lib/cloudflare-pages.js'
import { DEPLOY_ERROR_GUIDES } from '../../../_lib/deploy-status.js'
import { resolveDeploySite } from '../[site].js'

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const id = new URL(context.request.url).searchParams.get('id') ?? ''
  if (!/^dep_[a-f0-9-]{36}$/.test(id)) return jsonResponse({ ok: false, error: '배포 id가 올바르지 않습니다.' }, 400)

  try {
    let job = await getDeployJob(db, id)
    if (!job || job.siteId !== resolved.siteId) {
      return jsonResponse({ ok: false, error: '해당 사이트의 배포 기록을 찾을 수 없습니다.' }, 404)
    }

    // API Mode + 진행 중 + Pages 배포 id가 있으면 실제 상태 조회
    if (['building', 'deploying'].includes(job.status) && job.pagesDeploymentId !== '' && hasCloudflareApi(context.env)) {
      const remote = await getPagesDeployment(context.env, { project: job.pagesProject, deploymentId: job.pagesDeploymentId })
      if (remote.ok && remote.deployment) {
        const { stageName, stageStatus, url } = remote.deployment
        if (stageStatus === 'failure' || stageStatus === 'failed') {
          job = (await transitionDeployJob(db, id, ['building', 'deploying'], 'failed', {
            errorCode: 'pages_build_failed',
            errorMessage: DEPLOY_ERROR_GUIDES.pages_build_failed,
            completedAt: new Date().toISOString(),
            deploymentResult: { ...(job.deploymentResult ?? {}), lastStage: stageName, lastStageStatus: stageStatus },
          })) ?? job
        } else if (stageName === 'deploy' && stageStatus === 'success') {
          job = (await transitionDeployJob(db, id, ['building', 'deploying'], 'verifying', {
            previewUrl: url || job.previewUrl,
            deploymentResult: { ...(job.deploymentResult ?? {}), lastStage: stageName, lastStageStatus: stageStatus, note: '빌드 완료 — [배포 후 검증]을 실행해 주세요.' },
          })) ?? job
        } else if (stageName === 'deploy') {
          job = (await transitionDeployJob(db, id, ['building'], 'deploying', {
            deploymentResult: { ...(job.deploymentResult ?? {}), lastStage: stageName, lastStageStatus: stageStatus },
          })) ?? job
        }
      }
    }

    return jsonResponse({ ok: true, job })
  } catch (e) {
    console.error(`[배포 상태] 조회 실패 site=${resolved.siteId} id=${id}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
