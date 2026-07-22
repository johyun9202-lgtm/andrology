// ============================================================
// ImportRepository — import_jobs 테이블 접근 계층 (Cloudflare D1)
//
// prepared statement + 바인딩 파라미터만 사용합니다.
// (migrations/0006_create_import_jobs.sql)
// ============================================================

export const IMPORT_STATUSES = ['running', 'completed', 'partial_success', 'failed']

const IMPORT_FIELDS =
  'id, site_id, source_url, status, pages_scanned, pages_failed, score, result, ' +
  'error_message, applied_at, applied_fields, started_at, completed_at, created_at'

function toImportJob(row, { includeResult = true } = {}) {
  if (!row) return null
  let result = null
  let appliedFields = []
  if (includeResult && row.result) {
    try { result = JSON.parse(row.result) } catch { result = null }
  }
  if (row.applied_fields) {
    try { appliedFields = JSON.parse(row.applied_fields) } catch { appliedFields = [] }
  }
  const job = {
    id: row.id,
    siteId: row.site_id,
    sourceUrl: row.source_url,
    status: row.status,
    pagesScanned: row.pages_scanned ?? 0,
    pagesFailed: row.pages_failed ?? 0,
    score: row.score ?? 0,
    errorMessage: row.error_message ?? null,
    appliedAt: row.applied_at ?? null,
    appliedFields,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
  }
  if (includeResult) job.result = result
  return job
}

export async function insertImportJob(db, { id, siteId, sourceUrl }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO import_jobs (id, site_id, source_url, status, started_at, created_at)
       VALUES (?, ?, ?, 'running', ?, ?)`
    )
    .bind(id, siteId, sourceUrl, now, now)
    .run()
}

// 수집 완료(성공/부분 성공) 기록
export async function completeImportJob(db, id, { status, sourceUrl, pagesScanned, pagesFailed, score, result }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE import_jobs SET status = ?, source_url = ?, pages_scanned = ?, pages_failed = ?,
         score = ?, result = ?, error_message = NULL, completed_at = ?
       WHERE id = ?`
    )
    .bind(status, sourceUrl, pagesScanned, pagesFailed, score, JSON.stringify(result), now, id)
    .run()
}

export async function failImportJob(db, id, errorMessage) {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE import_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`)
    .bind(String(errorMessage ?? '알 수 없는 오류').slice(0, 500), now, id)
    .run()
}

export async function getImportJob(db, id) {
  const row = await db.prepare(`SELECT ${IMPORT_FIELDS} FROM import_jobs WHERE id = ?`).bind(id).first()
  return toImportJob(row)
}

// 사이트의 최신 Import (결과 포함)
export async function latestImportForSite(db, siteId) {
  const row = await db
    .prepare(`SELECT ${IMPORT_FIELDS} FROM import_jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(siteId)
    .first()
  return toImportJob(row)
}

// 과거 Import 이력 (메타만 — result 미포함)
export async function listImportHistory(db, siteId, limit = 5) {
  const { results } = await db
    .prepare(`SELECT ${IMPORT_FIELDS} FROM import_jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(siteId, Math.min(20, Math.max(1, limit)))
    .all()
  return (results ?? []).map((row) => toImportJob(row, { includeResult: false }))
}

// 적용 이력 기록 (해당 Import의 site_id가 일치할 때만)
export async function markImportApplied(db, id, siteId, appliedFields) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(`UPDATE import_jobs SET applied_at = ?, applied_fields = ? WHERE id = ? AND site_id = ?`)
    .bind(now, JSON.stringify(appliedFields), id, siteId)
    .run()
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0
}
