// /api/deployments/<siteId>/preflight — 배포 사전 검사 + 계획 미리보기 (Phase 15)
//
// 실행 기록 없이 검사·계획만 반환합니다. (실제 배포는 POST /api/deployments/<siteId>)
// 배포 시점에 서버가 같은 검사를 다시 수행하므로 이 결과는 안내용입니다.

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { runPreflight } from '../../../_lib/deploy-preflight.js'
import { DEPLOYMENT_TYPES } from '../../../_lib/deploy-status.js'
import { resolveDeploySite } from '../[site].js'

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 5_000)
  const type = DEPLOYMENT_TYPES.includes(body?.type) ? body.type : 'production'
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDeploySite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  try {
    const preflight = await runPreflight(context.env, db, resolved.siteId, type)
    return jsonResponse({
      ok: true,
      site: resolved.siteId,
      type,
      checks: preflight.checks,
      summary: preflight.summary,
      plan: preflight.plan,
    })
  } catch (e) {
    console.error(`[사전 검사] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '사전 검사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
