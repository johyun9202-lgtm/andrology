// /api/deployments — 전체 최근 배포 현황 (Phase 15)
//
// 운영 현황판·Phase 16 SEO Operation이 병원별 최근 배포 상태를 조회합니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { listRecentDeploys } from '../_lib/deploy-repository.js'
import { DEPLOY_STATUS_LABELS } from '../_lib/deploy-status.js'

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const site = new URL(context.request.url).searchParams.get('site') ?? ''
    let deployments = await listRecentDeploys(db, 20)
    if (site !== '') deployments = deployments.filter((job) => job.siteId === site)
    return jsonResponse({
      ok: true,
      deployments: deployments.map((job) => ({
        id: job.id, siteId: job.siteId, deploymentType: job.deploymentType, status: job.status,
        statusLabel: DEPLOY_STATUS_LABELS[job.status] ?? job.status,
        targetDomain: job.targetDomain, approvedBy: job.approvedBy,
        createdAt: job.createdAt, completedAt: job.completedAt,
      })),
    })
  } catch (e) {
    console.error(`[배포 목록] 조회 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 목록을 불러오지 못했습니다. (0008 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
