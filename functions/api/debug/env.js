// GET /api/debug/env — D1 바인딩 진단용 임시 엔드포인트
//
// ⚠ 문제 해결 후 이 파일은 삭제해도 됩니다.
// - 로그인한 관리자만 접근 가능 (미로그인 401)
// - env의 "키 이름과 타입"만 반환하며 값(비밀번호·Secret 등)은 절대 반환하지 않습니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../_lib/auth.js'
import { diagnoseDb } from '../../_lib/db.js'

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const diagnosis = diagnoseDb(context)
  console.log('[DB 진단/debug] ' + JSON.stringify(diagnosis))
  return jsonResponse({ ok: true, ...diagnosis })
}

export function onRequest() {
  return methodNotAllowed()
}
