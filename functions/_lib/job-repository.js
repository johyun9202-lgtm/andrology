// ============================================================
// JobRepository — jobs 테이블 접근 계층 (Cloudflare D1)
//
// Functions에서 SQL을 직접 쓰지 않고 이 저장소만 사용합니다.
// 모든 쿼리는 prepared statement + 바인딩 파라미터를 사용해
// SQL Injection이 원천적으로 불가능합니다.
//
// db = env.DB (Pages 프로젝트의 D1 바인딩, 변수명 "DB")
// ============================================================

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed']
export const MAX_LIST_LIMIT = 30

const JOB_FIELDS =
  'id, type, site, keyword, title, status, progress, result, error, started_at, completed_at, created_at, updated_at'

// DB 행 → API 응답용 Job 객체 (스네이크 케이스 → 카멜 케이스)
function toJob(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    site: row.site,
    keyword: row.keyword,
    title: row.title ?? '',
    status: row.status,
    progress: row.progress ?? 0,
    result: row.result ?? null,
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function insertJob(db, { id, type, site, keyword, title }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO jobs (${JOB_FIELDS}) VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, ?, ?)`
    )
    .bind(id, type, site, keyword, title ?? '', now, now)
    .run()
  return getJob(db, id)
}

export async function listJobs(db, limit = MAX_LIST_LIMIT) {
  const capped = Math.min(Math.max(1, Number(limit) || MAX_LIST_LIMIT), MAX_LIST_LIMIT)
  const { results } = await db
    .prepare(`SELECT ${JOB_FIELDS} FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(capped)
    .all()
  return (results ?? []).map(toJob)
}

export async function getJob(db, id) {
  const row = await db
    .prepare(`SELECT ${JOB_FIELDS} FROM jobs WHERE id = ?`)
    .bind(id)
    .first()
  return toJob(row)
}

// status/progress/result/error 중 전달된 항목만 갱신합니다.
export async function updateJob(db, id, { status, progress, result, error }) {
  const sets = []
  const values = []
  if (status !== undefined) { sets.push('status = ?'); values.push(status) }
  if (progress !== undefined) { sets.push('progress = ?'); values.push(progress) }
  if (result !== undefined) { sets.push('result = ?'); values.push(result) }
  if (error !== undefined) { sets.push('error = ?'); values.push(error) }
  if (sets.length === 0) return getJob(db, id)
  sets.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)
  const info = await db
    .prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
  const changed = info?.meta?.changes ?? info?.changes
  if (changed === 0) return null
  return getJob(db, id)
}

// ------------------------------------------------------------
// Phase 6 — 실행 엔진 전용 상태 전이
// ------------------------------------------------------------

// 실행 선점(claim): 상태 검사와 running 전환을 "한 번의 UPDATE"로 수행합니다.
// WHERE status IN ('queued','failed') 조건 덕분에 두 요청이 동시에 들어와도
// 정확히 하나만 성공(changes=1)하며, 나머지는 false를 받습니다.
// (프론트 버튼 비활성화와 별개로 서버에서 중복 실행을 원천 차단)
export async function claimJobForRun(db, id) {
  const now = new Date().toISOString()
  const info = await db
    .prepare(
      `UPDATE jobs
         SET status = 'running', progress = 10, error = NULL, started_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed')`
    )
    .bind(now, now, id)
    .run()
  return (info?.meta?.changes ?? info?.changes) === 1
}

// 실행 성공: 결과 저장 + completed
export async function markJobCompleted(db, id, result) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET status = 'completed', progress = 100, result = ?, error = NULL,
             completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(result, now, now, id)
    .run()
  return getJob(db, id)
}

// 실행 실패: 오류 메시지 저장 + failed (이후 "다시 실행" 가능)
export async function markJobFailed(db, id, errorMessage) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(errorMessage, now, now, id)
    .run()
  return getJob(db, id)
}
