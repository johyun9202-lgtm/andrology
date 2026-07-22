// /api/onboarding — 병원별 온보딩 목록 + 진행률 (Phase 14A Client Onboarding Engine)
//
// - 관리자 인증 필수
// - D1(site_onboarding) 기준이므로 재배포 전에 생성한 사이트도 즉시 표시됩니다.
// - 개별 조회·수정: /api/onboarding/<siteId> (onboarding/[site].js)

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { listOnboarding } from '../_lib/onboarding-repository.js'
import { OPERATION_MODES, CHECKLIST_ITEMS } from '../_lib/onboarding.js'

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const records = await listOnboarding(db)
    return jsonResponse({
      ok: true,
      records,
      // 대시보드 렌더링용 메타 (라벨을 서버 한 곳에서 관리)
      operationModes: OPERATION_MODES,
      checklistItems: CHECKLIST_ITEMS,
    })
  } catch (e) {
    console.error(`[온보딩 목록] 조회 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '온보딩 목록을 불러오지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
