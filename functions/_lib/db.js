// ============================================================
// D1 바인딩 접근 + 자가진단
//
// context.env.DB 가 정상적인 D1 객체인지 확인하고,
// 문제가 있으면 "무엇이 잘못됐는지"를 구분해 알려줍니다.
// (진단 로그에는 값이 아니라 키 이름과 타입만 출력 — Secret 값 노출 없음)
// ============================================================

import { jsonResponse } from './auth.js'

export function getDb(context) {
  const db = context.env?.DB
  return db && typeof db.prepare === 'function' ? db : null
}

// env.DB 상태를 분석해 진단 정보를 반환합니다.
export function diagnoseDb(context) {
  const env = context.env ?? {}
  const db = env.DB
  const info = {
    envKeys: Object.keys(env),
    dbType: typeof db,
    dbPrepareType: typeof db?.prepare,
  }

  let cause
  if (db === undefined) {
    cause =
      "D1 바인딩 'DB'가 이 배포 환경(env)에 존재하지 않습니다. " +
      'Pages → Settings → Bindings에서 변수명 DB가 지금 접속 중인 환경(Production/Preview)에 설정되어 있는지 확인하고, 설정 후 새 배포가 필요합니다.'
  } else if (typeof db === 'string') {
    cause =
      "'DB'가 D1 바인딩이 아니라 일반 텍스트 변수(Variables and Secrets)로 설정되어 있습니다. " +
      '텍스트 변수 DB를 삭제하고, Settings → Bindings → D1 database에서 변수명 DB로 다시 추가해 주세요.'
  } else if (typeof db?.prepare !== 'function') {
    cause = "'DB'가 존재하지만 D1 데이터베이스 객체가 아닙니다. 바인딩 유형이 D1 database인지 확인해 주세요."
  } else {
    cause = 'DB 바인딩 정상.'
  }

  return { ...info, cause }
}

// DB가 없을 때의 공통 처리: 진단 로그 출력 + 원인별 오류 응답
// (이 API들은 로그인한 관리자만 접근 가능하므로 상세 안내를 담아도 안전합니다)
export function dbUnavailableResponse(context) {
  const diagnosis = diagnoseDb(context)
  // Cloudflare 실시간 로그(Functions logs)에서 확인용 — 값은 출력하지 않음
  console.log('[DB 진단] envKeys=' + JSON.stringify(diagnosis.envKeys) +
    ' dbType=' + diagnosis.dbType +
    ' dbPrepareType=' + diagnosis.dbPrepareType)
  return jsonResponse({ ok: false, error: `서버 저장소 설정이 완료되지 않았습니다. ${diagnosis.cause}` }, 500)
}
