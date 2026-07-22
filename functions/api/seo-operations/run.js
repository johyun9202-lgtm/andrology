// /api/seo-operations/run — 병원별 수동 점검 실행 (Phase 16)
//
// - 운영 대상(checkable) 사이트만 실행 (paused·운영 전 사이트 차단)
// - 실행 중 중복 409, post_deploy는 같은 배포에 대한 중복 점검 방지
// - Cron/스케줄러도 이 엔드포인트를 그대로 호출할 수 있습니다 (trigger_type)

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { runSeoCheck } from '../../_lib/seo-runner.js'
import { findActiveRun } from '../../_lib/seo-repository.js'
import { resolveSeoSite, siteOperabilityContext } from './[site].js'

const TRIGGER_TYPES = ['manual', 'scheduled', 'post_deploy']

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 5_000)
  if (body === null || typeof body !== 'object') return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveSeoSite(db, body.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)
  const triggerType = TRIGGER_TYPES.includes(body.triggerType) ? body.triggerType : 'manual'

  try {
    const { classification } = await siteOperabilityContext(db, resolved.siteId, resolved.onboarding)
    if (!classification.checkable) {
      return jsonResponse(
        { ok: false, error: `이 사이트는 현재 점검 대상이 아닙니다 (${classification.operability}). ${classification.reason}` },
        400
      )
    }
    const active = await findActiveRun(db, resolved.siteId)
    if (active) {
      return jsonResponse({ ok: false, error: '이미 점검이 실행 중입니다. 완료 후 다시 시도해 주세요.', activeRunId: active.id }, 409)
    }

    const { run } = await runSeoCheck(context.env, db, resolved.siteId, { triggerType })
    return jsonResponse({ ok: run.status !== 'failed', run, error: run.status === 'failed' ? run.errorMessage : undefined })
  } catch (e) {
    console.error(`[SEO 점검 실행] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '점검 실행 중 오류가 발생했습니다. (0009 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
