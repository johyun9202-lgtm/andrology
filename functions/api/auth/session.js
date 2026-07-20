// GET /api/auth/session — 현재 로그인 여부 확인 (Secret 정보는 반환하지 않음)

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../_lib/auth.js'

export async function onRequestGet(context) {
  const authenticated = await isAuthenticated(context)
  return jsonResponse({ ok: true, authenticated })
}

export function onRequest() {
  return methodNotAllowed()
}
