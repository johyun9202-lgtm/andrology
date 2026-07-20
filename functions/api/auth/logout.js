// POST /api/auth/logout — 세션 쿠키 만료

import { jsonResponse, methodNotAllowed, clearSessionCookieHeader } from '../../_lib/auth.js'

export function onRequestPost() {
  return jsonResponse({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader() })
}

export function onRequest() {
  return methodNotAllowed()
}
