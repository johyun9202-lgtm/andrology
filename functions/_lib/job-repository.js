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
export const PUBLISH_STATUSES = ['draft', 'publishing', 'published', 'publish_failed', 'deleted']
export const DEPLOYMENT_STATUSES = ['pending', 'deployed', 'deploy_failed']
export const MAX_LIST_LIMIT = 30
export const PUBLISHED_PAGE_SIZE = 20

// publishing 상태로 방치된 Job(요청 중단 등)은 이 시간이 지나면 재시도(재선점)를 허용
const STALE_PUBLISHING_MS = 15 * 60 * 1000

const JOB_FIELDS =
  'id, type, site, keyword, title, status, progress, result, error, started_at, completed_at, ' +
  'publish_status, published_path, published_url, publish_commit_sha, publish_error_message, published_at, publish_started_at, ' +
  'deployment_status, deployment_checked_at, deployment_error_message, deployment_attempts, deleted_at, updated_commit_sha, article_updated_at, ' +
  'created_at, updated_at'

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
    publishStatus: row.publish_status ?? 'draft',
    publishedPath: row.published_path ?? null,
    publishedUrl: row.published_url ?? null,
    publishCommitSha: row.publish_commit_sha ?? null,
    publishErrorMessage: row.publish_error_message ?? null,
    publishedAt: row.published_at ?? null,
    publishStartedAt: row.publish_started_at ?? null,
    deploymentStatus: row.deployment_status ?? 'pending',
    deploymentCheckedAt: row.deployment_checked_at ?? null,
    deploymentErrorMessage: row.deployment_error_message ?? null,
    deploymentAttempts: row.deployment_attempts ?? 0,
    deletedAt: row.deleted_at ?? null,
    updatedCommitSha: row.updated_commit_sha ?? null,
    articleUpdatedAt: row.article_updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function insertJob(db, { id, type, site, keyword, title }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO jobs (${JOB_FIELDS}) VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, 'draft', NULL, NULL, NULL, NULL, NULL, NULL, 'pending', NULL, NULL, 0, NULL, NULL, NULL, ?, ?)`
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

// ------------------------------------------------------------
// Phase 7 — 게시(Publishing) 상태 전이
// ------------------------------------------------------------

// 게시 선점(claim): 상태 검사와 publishing 전환을 한 번의 조건부 UPDATE로 수행.
// - AI 생성이 completed인 Job만
// - publish_status가 draft/publish_failed일 때만 (published/publishing 재게시 차단)
// - 단, publishing 상태로 15분 이상 방치된 경우(요청 중단 등)는 재선점 허용
export async function claimJobForPublish(db, id) {
  const now = new Date()
  const iso = now.toISOString()
  const staleCutoff = new Date(now.getTime() - STALE_PUBLISHING_MS).toISOString()
  const info = await db
    .prepare(
      `UPDATE jobs
         SET publish_status = 'publishing', publish_started_at = ?, publish_error_message = NULL, updated_at = ?
       WHERE id = ? AND status = 'completed'
         AND (publish_status IN ('draft', 'publish_failed')
              OR (publish_status = 'publishing' AND publish_started_at <= ?))`
    )
    .bind(iso, iso, id, staleCutoff)
    .run()
  return (info?.meta?.changes ?? info?.changes) === 1
}

// 게시 성공: 경로·URL·커밋 SHA 저장 + published (배포 확인 상태는 pending으로 초기화)
export async function markJobPublished(db, id, { path, url, sha }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET publish_status = 'published', published_path = ?, published_url = ?, publish_commit_sha = ?,
             publish_error_message = NULL, published_at = ?,
             deployment_status = 'pending', deployment_checked_at = NULL, deployment_error_message = NULL,
             updated_at = ?
       WHERE id = ?`
    )
    .bind(path, url, sha, now, now, id)
    .run()
  return getJob(db, id)
}

// 게시 실패: 안전한 오류 메시지 저장 + publish_failed (이후 "게시 다시 시도" 가능)
export async function markJobPublishFailed(db, id, errorMessage) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET publish_status = 'publish_failed', publish_error_message = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(errorMessage, now, id)
    .run()
  return getJob(db, id)
}

// ------------------------------------------------------------
// Phase 8 — 배포 확인 / 게시 글 관리
// ------------------------------------------------------------

// 배포 확인 결과 기록 (시도 횟수는 SQL에서 증가 — 상태/시각/메시지만 저장)
export async function markDeploymentChecked(db, id, { status, error = null }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET deployment_status = ?, deployment_checked_at = ?, deployment_error_message = ?,
             deployment_attempts = deployment_attempts + 1, updated_at = ?
       WHERE id = ?`
    )
    .bind(status, now, error, now, id)
    .run()
  return getJob(db, id)
}

// 게시 글 수정 성공: 수정 커밋 SHA + 수정 시각 저장, 배포 확인은 pending으로 초기화
// (수정된 D1 result도 함께 갱신해 Dashboard 미리보기와 실제 파일을 일치시킴)
export async function markArticleUpdated(db, id, { sha, result }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET updated_commit_sha = ?, article_updated_at = ?, result = ?,
             deployment_status = 'pending', deployment_checked_at = NULL, deployment_error_message = NULL,
             updated_at = ?
       WHERE id = ?`
    )
    .bind(sha, now, result, now, id)
    .run()
  return getJob(db, id)
}

// 게시 글 삭제 성공: publish_status=deleted (Job·게시 이력은 감사용으로 유지)
export async function markArticleDeleted(db, id, { sha }) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE jobs
         SET publish_status = 'deleted', deleted_at = ?, updated_commit_sha = ?,
             deployment_status = 'pending', deployment_checked_at = NULL, deployment_error_message = NULL,
             updated_at = ?
       WHERE id = ?`
    )
    .bind(now, sha, now, id)
    .run()
  return getJob(db, id)
}

// LIKE 검색어의 특수문자 이스케이프 (% _ \)
function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

// 게시된 글 목록 (published/deleted) — 최신순 + 페이지네이션 + 필터
// 모든 조건은 바인딩 파라미터만 사용 (SQL Injection 불가)
export async function listPublishedJobs(
  db,
  { site, publishStatus, deploymentStatus, search, page = 1, pageSize = PUBLISHED_PAGE_SIZE } = {}
) {
  const where = ["publish_status IN ('published', 'deleted')"]
  const values = []
  if (site) { where.push('site = ?'); values.push(site) }
  if (publishStatus) { where.push('publish_status = ?'); values.push(publishStatus) }
  if (deploymentStatus) { where.push('deployment_status = ?'); values.push(deploymentStatus) }
  if (search) {
    where.push("(keyword LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR result LIKE ? ESCAPE '\\')")
    const pattern = `%${escapeLike(search)}%`
    values.push(pattern, pattern, pattern)
  }
  const whereSql = where.join(' AND ')

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM jobs WHERE ${whereSql}`)
    .bind(...values)
    .first()
  const total = Number(countRow?.total ?? 0)

  const size = Math.min(Math.max(1, Number(pageSize) || PUBLISHED_PAGE_SIZE), 50)
  const pageNum = Math.max(1, Number(page) || 1)
  const { results } = await db
    .prepare(
      `SELECT ${JOB_FIELDS} FROM jobs WHERE ${whereSql}
       ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .bind(...values, size, (pageNum - 1) * size)
    .all()

  return { jobs: (results ?? []).map(toJob), total, page: pageNum, pageSize: size }
}
