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
import { getDb } from '../../_lib/db.js'
import { clientIp, recordLoginAttempt, resetLoginAttempts } from '../../_lib/login-rate-limit.js'

export async function onRequestPost(context) {
  const { env, request } = context

  if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD === '' ||
      typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 16) {
    // Secret 미설정 — 상세 내용은 노출하지 않음
    return jsonResponse({ ok: false, error: '서버 설정이 완료되지 않았습니다.' }, 500)
  }

  const ip = clientIp(request)
  const db = getDb(context)
  const now = Date.now()

  // (반복 시도 방어) 비밀번호를 확인하기 전에 먼저 시도 횟수를 기록·확인합니다.
  // 임계값을 넘으면 비밀번호 비교 자체를 하지 않고 즉시 429를 반환합니다 —
  // 응답 문구는 아이디/비밀번호 오류 때와 마찬가지로 계정 존재 여부를 알 수
  // 없는 일반적인 문구만 사용합니다. D1 바인딩이 없거나 오류가 나면(가용성
  // 우선 원칙) 제한 없이 통과시킵니다.
  if (db) {
    const limit = await recordLoginAttempt(db, ip, now)
    if (limit.limited) {
      return jsonResponse(
        { ok: false, error: '너무 많은 시도가 있었습니다. 잠시 후 다시 시도해 주세요.' },
        429,
        { 'retry-after': String(limit.retryAfterSeconds) }
      )
    }
  }

  const body = await readJsonBody(request, 2_000)
  const password = body?.password
  if (typeof password !== 'string' || password === '' || password.length > 200) {
    return jsonResponse({ ok: false, error: '인증에 실패했습니다.' }, 401)
  }

  if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ ok: false, error: '인증에 실패했습니다.' }, 401)
  }

  if (db) {
    // 응답을 늦추지 않도록 완료를 기다리지 않습니다 — 실패해도 다음 윈도우에서
    // 자연히 초기화되므로 로그인 성공 자체에는 영향이 없습니다.
    context.waitUntil ? context.waitUntil(resetLoginAttempts(db, ip, now)) : resetLoginAttempts(db, ip, now)
  }

  const token = await createSessionToken(env.SESSION_SECRET)
  return jsonResponse({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(token) })
}

export function onRequest() {
  return methodNotAllowed()
}
