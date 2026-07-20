// POST /api/auth/login — 관리자 로그인
// body: { password } / 성공: 서명된 세션 쿠키 발급 / 실패: 401 (내부 정보 미노출)

import {
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  createSessionToken,
  sessionCookieHeader,
  timingSafeEqual,
} from '../../_lib/auth.js'

export async function onRequestPost(context) {
  const { env, request } = context

  if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD === '' ||
      typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    // Secret 미설정 — 상세 내용은 노출하지 않음
    return jsonResponse({ ok: false, error: '서버 설정이 완료되지 않았습니다.' }, 500)
  }

  const body = await readJsonBody(request, 2_000)
  const password = body?.password
  if (typeof password !== 'string' || password === '' || password.length > 200) {
    return jsonResponse({ ok: false, error: '인증에 실패했습니다.' }, 401)
  }

  if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ ok: false, error: '인증에 실패했습니다.' }, 401)
  }

  const token = await createSessionToken(env.SESSION_SECRET)
  return jsonResponse({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(token) })
}

export function onRequest() {
  return methodNotAllowed()
}
