// ============================================================
// DeployRepository — deploy_jobs / site_deploy_config 접근 계층 (Cloudflare D1)
//
// prepared statement + 바인딩 파라미터만 사용합니다.
// (migrations/0008_create_deploy_jobs.sql)
// ============================================================

import { ACTIVE_STATUSES, STALE_DEPLOY_MS } from './deploy-status.js'

const JOB_FIELDS =
  'id, site_id, deployment_type, status, target_domain, operation_mode, git_branch, git_commit_sha, ' +
  'pages_project, pages_deployment_id, preview_url, production_url, preflight_result, deployment_result, ' +
  'verification_result, rollback_source_id, rollback_reason, approved_by, approved_at, started_at, ' +
  'completed_at, error_code, error_message, created_at, updated_at'

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function toDeployJob(row, { includeResults = true } = {}) {
  if (!row) return null
  const job = {
    id: row.id,
    siteId: row.site_id,
    deploymentType: row.deployment_type,
    status: row.status,
    targetDomain: row.target_domain ?? '',
    operationMode: row.operation_mode ?? 'independent',
    gitBranch: row.git_branch ?? '',
    gitCommitSha: row.git_commit_sha ?? '',
    pagesProject: row.pages_project ?? '',
    pagesDeploymentId: row.pages_deployment_id ?? '',
    previewUrl: row.preview_url ?? '',
    productionUrl: row.production_url ?? '',
    rollbackSourceId: row.rollback_source_id ?? '',
    rollbackReason: row.rollback_reason ?? '',
    approvedBy: row.approved_by ?? '',
    approvedAt: row.approved_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    errorCode: row.error_code ?? '',
    errorMessage: row.error_message ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (includeResults) {
    job.preflightResult = parseJson(row.preflight_result)
    job.deploymentResult = parseJson(row.deployment_result)
    job.verificationResult = parseJson(row.verification_result)
  }
  return job
}

export async function insertDeployJob(db, data) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO deploy_jobs (
         id, site_id, deployment_type, status, target_domain, operation_mode, git_branch,
         git_commit_sha, pages_project, pages_deployment_id, preview_url, production_url,
         preflight_result, deployment_result, approved_by, approved_at, started_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id, data.siteId, data.deploymentType, data.status, data.targetDomain ?? '',
      data.operationMode ?? 'independent', data.gitBranch ?? '', data.gitCommitSha ?? '',
      data.pagesProject ?? '', data.pagesDeploymentId ?? '', data.previewUrl ?? '', data.productionUrl ?? '',
      JSON.stringify(data.preflightResult ?? null), JSON.stringify(data.deploymentResult ?? null),
      data.approvedBy ?? '', data.approvedAt ?? null, now, now, now
    )
    .run()
  return getDeployJob(db, data.id)
}

export async function getDeployJob(db, id) {
  const row = await db.prepare(`SELECT ${JOB_FIELDS} FROM deploy_jobs WHERE id = ?`).bind(id).first()
  return toDeployJob(row)
}

// 조건부 상태 전이 (낙관적 잠금 — 현재 상태가 fromStatus일 때만 갱신)
const UPDATABLE = {
  pagesDeploymentId: 'pages_deployment_id',
  previewUrl: 'preview_url',
  productionUrl: 'production_url',
  gitCommitSha: 'git_commit_sha',
  deploymentResult: 'deployment_result',
  verificationResult: 'verification_result',
  rollbackSourceId: 'rollback_source_id',
  rollbackReason: 'rollback_reason',
  errorCode: 'error_code',
  errorMessage: 'error_message',
  completedAt: 'completed_at',
}

export async function transitionDeployJob(db, id, fromStatuses, toStatus, fields = {}) {
  const sets = ['status = ?', 'updated_at = ?']
  const values = [toStatus, new Date().toISOString()]
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] === undefined) continue
    let value = fields[key]
    if (key === 'deploymentResult' || key === 'verificationResult') value = JSON.stringify(value ?? null)
    sets.push(`${column} = ?`)
    values.push(value)
  }
  const from = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses]
  const placeholders = from.map(() => '?').join(', ')
  const result = await db
    .prepare(`UPDATE deploy_jobs SET ${sets.join(', ')} WHERE id = ? AND status IN (${placeholders})`)
    .bind(...values, id, ...from)
    .run()
  if ((result?.meta?.changes ?? result?.changes ?? 0) === 0) return null
  return getDeployJob(db, id)
}

// 진행 중 배포 (중복 실행 차단용 — 오래된 것은 지연으로 간주해 제외)
export async function findActiveDeploy(db, siteId) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ')
  const row = await db
    .prepare(`SELECT ${JOB_FIELDS} FROM deploy_jobs WHERE site_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`)
    .bind(siteId, ...ACTIVE_STATUSES)
    .first()
  const job = toDeployJob(row)
  if (!job) return null
  const age = Date.now() - Date.parse(job.createdAt ?? 0)
  return age > STALE_DEPLOY_MS ? null : job
}

// 사이트 배포 이력 (최신순)
export async function listDeploysForSite(db, siteId, limit = 10) {
  const { results } = await db
    .prepare(`SELECT ${JOB_FIELDS} FROM deploy_jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(siteId, Math.min(30, Math.max(1, limit)))
    .all()
  return (results ?? []).map((row) => toDeployJob(row, { includeResults: false }))
}

// 전체 최근 배포 (운영 현황)
export async function listRecentDeploys(db, limit = 20) {
  const { results } = await db
    .prepare(`SELECT ${JOB_FIELDS} FROM deploy_jobs ORDER BY created_at DESC LIMIT ?`)
    .bind(Math.min(50, Math.max(1, limit)))
    .all()
  return (results ?? []).map((row) => toDeployJob(row, { includeResults: false }))
}

// 직전 성공 배포 (rollback 대상 — production/replace만)
export async function lastSuccessfulDeploy(db, siteId, excludeId = '') {
  const row = await db
    .prepare(
      `SELECT ${JOB_FIELDS} FROM deploy_jobs
       WHERE site_id = ? AND status = 'success' AND deployment_type IN ('production', 'replace') AND id != ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(siteId, excludeId)
    .first()
  return toDeployJob(row)
}

// ---------- site_deploy_config ----------

export async function getDeployConfig(db, siteId) {
  const row = await db
    .prepare(`SELECT site_id, pages_project, git_branch, production_branch, build_command, output_directory, deployment_strategy, updated_at FROM site_deploy_config WHERE site_id = ?`)
    .bind(siteId)
    .first()
  if (!row) return null
  return {
    siteId: row.site_id,
    pagesProject: row.pages_project ?? '',
    gitBranch: row.git_branch ?? '',
    productionBranch: row.production_branch ?? '',
    buildCommand: row.build_command ?? '',
    outputDirectory: row.output_directory ?? '',
    deploymentStrategy: row.deployment_strategy ?? 'shared',
    updatedAt: row.updated_at,
  }
}

export async function upsertDeployConfig(db, siteId, config) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO site_deploy_config (site_id, pages_project, git_branch, production_branch, build_command, output_directory, deployment_strategy, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET
         pages_project = excluded.pages_project, git_branch = excluded.git_branch,
         production_branch = excluded.production_branch, build_command = excluded.build_command,
         output_directory = excluded.output_directory, deployment_strategy = excluded.deployment_strategy,
         updated_at = excluded.updated_at`
    )
    .bind(
      siteId, config.pagesProject ?? '', config.gitBranch ?? '', config.productionBranch ?? '',
      config.buildCommand ?? '', config.outputDirectory ?? '', config.deploymentStrategy ?? 'shared', now
    )
    .run()
  return getDeployConfig(db, siteId)
}

// 유효 배포 설정 (테이블 값 → env 기본값 순)
export function resolveDeployConfig(env, siteId, stored) {
  return {
    siteId,
    pagesProject: stored?.pagesProject || (env?.CLOUDFLARE_PAGES_PROJECT ?? '').trim(),
    gitBranch: stored?.gitBranch || (env?.GITHUB_BRANCH ?? 'main').trim() || 'main',
    productionBranch: stored?.productionBranch || (env?.GITHUB_BRANCH ?? 'main').trim() || 'main',
    deploymentStrategy: stored?.deploymentStrategy || 'shared',
  }
}
