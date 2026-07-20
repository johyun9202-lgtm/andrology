// ============================================================
// D1 바인딩 공통 접근 + 안전한 오류 응답
//
// context.env.DB 가 정상적인 D1 객체일 때만 반환합니다.
// 바인딩이 없거나 잘못된 경우 오류 응답을 한 곳에서 일관되게 처리합니다.
// (로그·응답에 값이나 Secret은 절대 포함하지 않습니다)
// ============================================================

import { jsonResponse } from './auth.js'

export function getDb(context) {
  const db = context.env?.DB
  return db && typeof db.prepare === 'function' ? db : null
}

// DB 바인딩을 사용할 수 없을 때의 공통 오류 응답
export function dbUnavailableResponse(context) {
  console.error(`[DB] D1 바인딩 'DB'를 사용할 수 없습니다. (typeof=${typeof context.env?.DB})`)
  return jsonResponse(
    { ok: false, error: '서버 저장소 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.' },
    500
  )
}
