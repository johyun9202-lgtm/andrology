// ============================================================
// 로그인 반복 시도 방어 (anti-brute-force) — Cloudflare Pages Functions + D1
//
// 방식: 고정 윈도우(fixed window) 카운터를 IP 기준으로 D1에 기록합니다.
// - bucket_key = "<ip>:<windowStart>" — 원자적(atomic) INSERT ... ON CONFLICT
//   DO UPDATE ... RETURNING 한 문장으로 "조회 후 증가"를 한 번에 처리하므로,
//   두 요청이 동시에 들어와도 카운트 증가 자체가 서로를 덮어쓰는 race condition이
//   생기지 않습니다(둘 다 정상적으로 +1씩 반영됨).
// - 다만 "카운트를 읽고 임계값과 비교해서 차단할지 결정하는" 단계는 요청마다
//   독립적으로 일어나므로, 임계값 부근에서 완전히 동시에 들어온 극소수 요청은
//   차단 시점이 1건 정도 어긋날 수 있습니다. 로그인처럼 저빈도 엔드포인트에서는
//   실질적 영향이 없고, 다음 요청부터는 즉시 반영되어 스스로 바로잡힙니다.
// - 계정이 하나뿐인 구조(단일 관리자 비밀번호)이므로 "계정별 제한"은 별도로
//   두지 않고 IP 기준 하나로 통일했습니다 — 계정 존재 여부는 어차피 노출하지
//   않으므로(성공/실패 응답이 항상 동일한 문구) 계정 단위 제한이 주는 추가
//   방어 효과가 없습니다.
// - D1 바인딩이 없거나 조회 자체가 실패하면 "차단하지 않고 통과"시킵니다.
//   (가용성 우선 — 저장소 장애가 관리자 로그인 자체를 막는 것을 방지. 대신
//   실패는 콘솔에 남겨 운영자가 인지할 수 있게 합니다.)
// ============================================================

const WINDOW_MS = 15 * 60 * 1000 // 15분
const MAX_ATTEMPTS = 8 // 윈도우당 허용 시도 횟수 (정상 사용자의 오타 2~3회는 여유롭게 허용)

// Cloudflare 엣지가 설정하는 헤더 — 클라이언트가 직접 위조할 수 없습니다
// (Cloudflare를 통과하는 요청에서는 이 헤더가 항상 엣지가 관측한 실제 접속 IP로 덮어써집니다).
export function clientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP')
  return typeof ip === 'string' && ip.trim() !== '' ? ip.trim() : 'unknown'
}

function bucketFor(ip, now) {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS
  return { windowStart, bucketKey: `${ip}:${windowStart}` }
}

// 이번 요청을 원자적으로 카운트에 반영하고, 임계값 초과 여부를 함께 반환합니다.
// 성공/실패 여부와 무관하게 "로그인 시도 자체"를 카운트합니다 — 그래야 잘못된
// 형식의 요청을 대량으로 보내 카운팅을 우회하는 것도 함께 막을 수 있습니다.
export async function recordLoginAttempt(db, ip, now = Date.now()) {
  const { windowStart, bucketKey } = bucketFor(ip, now)
  try {
    const row = await db
      .prepare(
        `INSERT INTO login_rate_limit (bucket_key, ip, window_start, attempt_count, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4)
         ON CONFLICT(bucket_key) DO UPDATE SET attempt_count = attempt_count + 1, updated_at = ?4
         RETURNING attempt_count`
      )
      .bind(bucketKey, ip, windowStart, now)
      .first()
    const count = typeof row?.attempt_count === 'number' ? row.attempt_count : 1
    const limited = count > MAX_ATTEMPTS
    const retryAfterSeconds = limited ? Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000)) : 0
    return { ok: true, limited, retryAfterSeconds, count }
  } catch (e) {
    console.error(`[로그인 속도 제한] 기록 실패(통과 처리): ${e?.message ?? e}`)
    return { ok: false, limited: false, retryAfterSeconds: 0, count: 0 }
  }
}

// 로그인 성공 시 해당 IP의 현재 윈도우 카운트를 초기화합니다.
// (오타를 몇 번 낸 뒤 정상적으로 로그인한 관리자가, 같은 윈도우 안에서 남은
// 시도 횟수 걱정 없이 다시 로그인할 수 있도록 — 정상 사용에 불이익이 없게 함)
export async function resetLoginAttempts(db, ip, now = Date.now()) {
  const { bucketKey } = bucketFor(ip, now)
  try {
    await db.prepare(`DELETE FROM login_rate_limit WHERE bucket_key = ?1`).bind(bucketKey).run()
  } catch (e) {
    console.error(`[로그인 속도 제한] 초기화 실패(무시 가능): ${e?.message ?? e}`)
  }
}
