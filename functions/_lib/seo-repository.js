// ============================================================
// SeoRepository — seo_check_runs / seo_findings / seo_tasks / site_seo_settings (D1)
//
// prepared statement만 사용. finding은 fingerprint 기준으로 갱신(중복 생성 금지),
// 해결 판정·재발(reopened)·작업 동기화가 이 계층에서 일관되게 처리됩니다.
// ============================================================

import { computePriorityScore } from './seo-status.js'

const RUN_FIELDS =
  'id, site_id, status, trigger_type, pages_checked, pages_failed, overall_score, technical_score, ' +
  'content_score, entity_score, conversion_score, operations_score, findings_count, critical_count, ' +
  'warning_count, result_json, started_at, completed_at, error_code, error_message, created_at'
const FINDING_FIELDS =
  'id, check_run_id, site_id, fingerprint, category, rule_key, severity, title, description, affected_url, ' +
  'detected_value, expected_value, evidence_json, is_opportunity, status, first_detected_at, last_detected_at, ' +
  'resolved_at, created_at, updated_at'
const TASK_FIELDS =
  'id, site_id, finding_id, title, description, category, severity, priority_score, status, target_module, ' +
  'target_route, affected_url, recommended_action, auto_fixable, assigned_to, due_date, resolution_note, ' +
  'created_at, updated_at, resolved_at'

const parseJson = (text) => { try { return text ? JSON.parse(text) : null } catch { return null } }

function toRun(row, { includeResult = true } = {}) {
  if (!row) return null
  const run = {
    id: row.id, siteId: row.site_id, status: row.status, triggerType: row.trigger_type,
    pagesChecked: row.pages_checked ?? 0, pagesFailed: row.pages_failed ?? 0,
    overallScore: row.overall_score ?? 0,
    scores: {
      technical: row.technical_score ?? 0, content: row.content_score ?? 0, entity: row.entity_score ?? 0,
      conversion: row.conversion_score ?? 0, operations: row.operations_score ?? 0,
    },
    findingsCount: row.findings_count ?? 0, criticalCount: row.critical_count ?? 0, warningCount: row.warning_count ?? 0,
    startedAt: row.started_at ?? null, completedAt: row.completed_at ?? null,
    errorCode: row.error_code ?? '', errorMessage: row.error_message ?? '', createdAt: row.created_at,
  }
  if (includeResult) run.result = parseJson(row.result_json)
  return run
}

function toFinding(row) {
  if (!row) return null
  return {
    id: row.id, checkRunId: row.check_run_id, siteId: row.site_id, fingerprint: row.fingerprint,
    category: row.category, ruleKey: row.rule_key, severity: row.severity, title: row.title,
    description: row.description ?? '', affectedUrl: row.affected_url ?? '',
    detectedValue: row.detected_value ?? '', expectedValue: row.expected_value ?? '',
    evidence: parseJson(row.evidence_json), isOpportunity: row.is_opportunity === 1,
    status: row.status, firstDetectedAt: row.first_detected_at, lastDetectedAt: row.last_detected_at,
    resolvedAt: row.resolved_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toTask(row) {
  if (!row) return null
  return {
    id: row.id, siteId: row.site_id, findingId: row.finding_id ?? '', title: row.title,
    description: row.description ?? '', category: row.category, severity: row.severity,
    priorityScore: row.priority_score ?? 0, status: row.status, targetModule: row.target_module,
    targetRoute: row.target_route ?? '', affectedUrl: row.affected_url ?? '',
    recommendedAction: row.recommended_action ?? '', autoFixable: row.auto_fixable === 1,
    assignedTo: row.assigned_to ?? '', dueDate: row.due_date ?? '', resolutionNote: row.resolution_note ?? '',
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at ?? null,
  }
}

// ---------- runs ----------
export async function insertRun(db, { id, siteId, triggerType }) {
  const now = new Date().toISOString()
  await db
    .prepare(`INSERT INTO seo_check_runs (id, site_id, status, trigger_type, started_at, created_at) VALUES (?, ?, 'running', ?, ?, ?)`)
    .bind(id, siteId, triggerType, now, now)
    .run()
}

export async function completeRun(db, id, data) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE seo_check_runs SET status = ?, pages_checked = ?, pages_failed = ?, overall_score = ?,
         technical_score = ?, content_score = ?, entity_score = ?, conversion_score = ?, operations_score = ?,
         findings_count = ?, critical_count = ?, warning_count = ?, result_json = ?, completed_at = ? WHERE id = ?`
    )
    .bind(
      data.status, data.pagesChecked, data.pagesFailed, data.overallScore,
      data.scores.technical, data.scores.content, data.scores.entity, data.scores.conversion, data.scores.operations,
      data.findingsCount, data.criticalCount, data.warningCount,
      JSON.stringify(data.result).slice(0, 120_000), now, id
    )
    .run()
}

export async function failRun(db, id, errorCode, errorMessage) {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE seo_check_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ? WHERE id = ?`)
    .bind(errorCode, String(errorMessage ?? '').slice(0, 400), now, id)
    .run()
}

export async function getRun(db, id) {
  return toRun(await db.prepare(`SELECT ${RUN_FIELDS} FROM seo_check_runs WHERE id = ?`).bind(id).first())
}

export async function latestRunForSite(db, siteId, { includeResult = false } = {}) {
  const row = await db
    .prepare(`SELECT ${RUN_FIELDS} FROM seo_check_runs WHERE site_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1`)
    .bind(siteId)
    .first()
  return toRun(row, { includeResult })
}

export async function listRunsForSite(db, siteId, limit = 10) {
  const { results } = await db
    .prepare(`SELECT ${RUN_FIELDS} FROM seo_check_runs WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(siteId, Math.min(30, Math.max(1, limit)))
    .all()
  return (results ?? []).map((row) => toRun(row, { includeResult: false }))
}

// 실행 중 점검 (중복 실행 차단 — 10분 넘으면 지연으로 간주)
export async function findActiveRun(db, siteId) {
  const row = await db
    .prepare(`SELECT ${RUN_FIELDS} FROM seo_check_runs WHERE site_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`)
    .bind(siteId)
    .first()
  const run = toRun(row, { includeResult: false })
  if (!run) return null
  return Date.now() - Date.parse(run.createdAt) > 10 * 60 * 1000 ? null : run
}

// 최근 7일 점검 성공률용 집계
export async function recentRunStats(db, sinceIso) {
  const { results } = await db
    .prepare(`SELECT status, COUNT(*) AS cnt FROM seo_check_runs WHERE created_at >= ? GROUP BY status`)
    .bind(sinceIso)
    .all()
  return results ?? []
}

// ---------- findings (fingerprint 기반 갱신) ----------
export async function getFindingByFingerprint(db, fingerprint) {
  return toFinding(await db.prepare(`SELECT ${FINDING_FIELDS} FROM seo_findings WHERE fingerprint = ?`).bind(fingerprint).first())
}

// 탐지 목록 반영: 신규 생성 / 기존 열림 갱신 / resolved → reopened / ignored 유지
// 반환: { created, updated, reopened, activeFindings }
export async function applyDetections(db, siteId, runId, detections) {
  const now = new Date().toISOString()
  const stats = { created: 0, updated: 0, reopened: 0 }
  const activeFindings = []
  for (const det of detections) {
    const existing = await getFindingByFingerprint(db, det.fingerprint)
    if (!existing) {
      const id = `fnd_${crypto.randomUUID()}`
      await db
        .prepare(
          `INSERT INTO seo_findings (id, check_run_id, site_id, fingerprint, category, rule_key, severity, title,
             description, affected_url, detected_value, expected_value, evidence_json, is_opportunity, status,
             first_detected_at, last_detected_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
        )
        .bind(
          id, runId, siteId, det.fingerprint, det.category, det.ruleKey, det.severity, det.title,
          det.description, det.affectedUrl ?? '', det.detectedValue ?? '', det.expectedValue ?? '',
          JSON.stringify(det.evidence ?? null).slice(0, 4000), det.isOpportunity ? 1 : 0, now, now, now, now
        )
        .run()
      stats.created += 1
      activeFindings.push(await getFindingByFingerprint(db, det.fingerprint))
      continue
    }
    if (existing.status === 'ignored') {
      // 무시된 항목은 다시 열지 않음 — 마지막 발견 시각만 기록
      await db.prepare(`UPDATE seo_findings SET last_detected_at = ?, check_run_id = ?, updated_at = ? WHERE id = ?`).bind(now, runId, now, existing.id).run()
      continue
    }
    const reopen = existing.status === 'resolved'
    await db
      .prepare(
        `UPDATE seo_findings SET check_run_id = ?, severity = ?, description = ?, detected_value = ?,
           last_detected_at = ?, status = ?, resolved_at = ?, updated_at = ? WHERE id = ?`
      )
      .bind(runId, det.severity, det.description, det.detectedValue ?? '', now, reopen ? 'reopened' : existing.status, reopen ? null : existing.resolvedAt, now, existing.id)
      .run()
    stats[reopen ? 'reopened' : 'updated'] += 1
    activeFindings.push(await getFindingByFingerprint(db, det.fingerprint))
  }
  return { ...stats, activeFindings }
}

// 이번 점검에서 실제 평가된 규칙 중 더 이상 탐지되지 않은 열린 finding → resolved
export async function resolveClearedFindings(db, siteId, evaluatedRuleKeys, detectedFingerprints) {
  const now = new Date().toISOString()
  const { results } = await db
    .prepare(`SELECT ${FINDING_FIELDS} FROM seo_findings WHERE site_id = ? AND status IN ('open', 'acknowledged', 'in_progress', 'reopened')`)
    .bind(siteId)
    .all()
  const resolved = []
  for (const row of results ?? []) {
    const finding = toFinding(row)
    if (!evaluatedRuleKeys.includes(finding.ruleKey)) continue // 이번에 평가 안 된 규칙은 판정 보류
    if (detectedFingerprints.includes(finding.fingerprint)) continue
    await db
      .prepare(`UPDATE seo_findings SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, finding.id)
      .run()
    resolved.push(finding)
  }
  return resolved
}

export async function listFindings(db, siteId, { statuses = null, limit = 100 } = {}) {
  let sql = `SELECT ${FINDING_FIELDS} FROM seo_findings WHERE site_id = ?`
  const binds = [siteId]
  if (statuses && statuses.length > 0) {
    sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`
    binds.push(...statuses)
  }
  sql += ` ORDER BY last_detected_at DESC LIMIT ?`
  binds.push(Math.min(200, limit))
  const { results } = await db.prepare(sql).bind(...binds).all()
  return (results ?? []).map(toFinding)
}

// ---------- tasks ----------
export async function getTask(db, id) {
  return toTask(await db.prepare(`SELECT ${TASK_FIELDS} FROM seo_tasks WHERE id = ?`).bind(id).first())
}

export async function getTaskByFinding(db, findingId) {
  return toTask(await db.prepare(`SELECT ${TASK_FIELDS} FROM seo_tasks WHERE finding_id = ? ORDER BY created_at DESC LIMIT 1`).bind(findingId).first())
}

// finding ↔ task 동기화 (중복 작업 생성 금지)
// activeFindings: 이번 점검에서 열린(신규·갱신·재발) finding
// resolvedFindings: 이번 점검에서 해결 확인된 finding
export async function syncTasks(db, { activeFindings, resolvedFindings, rules, afterRecentDeploy, now }) {
  const nowIso = new Date(now).toISOString()
  const stats = { created: 0, updated: 0, reopened: 0, autoResolved: 0 }
  for (const finding of activeFindings) {
    const rule = rules.find((r) => r.key === finding.ruleKey)
    const priority = computePriorityScore({
      severity: finding.severity, category: finding.category, sitewide: rule?.sitewide === true,
      firstDetectedAt: finding.firstDetectedAt, autoFixable: false, afterRecentDeploy, now,
    })
    const existing = await getTaskByFinding(db, finding.id)
    if (!existing) {
      await db
        .prepare(
          `INSERT INTO seo_tasks (id, site_id, finding_id, title, description, category, severity, priority_score,
             status, target_module, target_route, affected_url, recommended_action, auto_fixable, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, 0, ?, ?)`
        )
        .bind(
          `tsk_${crypto.randomUUID()}`, finding.siteId, finding.id, finding.title, finding.description,
          finding.category, finding.severity, priority, rule?.targetModule ?? 'manual',
          rule?.targetRoute ?? '', finding.affectedUrl, rule?.action ?? '', nowIso, nowIso
        )
        .run()
      stats.created += 1
    } else if (existing.status === 'resolved') {
      // 직원이 완료 표시했지만 다음 점검에서 다시 발견됨 → reopened
      await db
        .prepare(`UPDATE seo_tasks SET status = 'reopened', priority_score = ?, resolution_note = ?, resolved_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(priority, `${existing.resolutionNote} [완료 표시했으나 다음 점검에서 다시 발견됨]`.trim().slice(0, 400), nowIso, existing.id)
        .run()
      stats.reopened += 1
    } else if (existing.status !== 'ignored') {
      await db
        .prepare(`UPDATE seo_tasks SET priority_score = ?, severity = ?, description = ?, updated_at = ? WHERE id = ?`)
        .bind(priority, finding.severity, finding.description, nowIso, existing.id)
        .run()
      stats.updated += 1
    }
  }
  for (const finding of resolvedFindings) {
    const task = await getTaskByFinding(db, finding.id)
    if (task && ['open', 'acknowledged', 'in_progress', 'reopened'].includes(task.status)) {
      await db
        .prepare(`UPDATE seo_tasks SET status = 'resolved', resolution_note = ?, resolved_at = ?, updated_at = ? WHERE id = ?`)
        .bind('다음 점검에서 문제 해결이 확인되었습니다.', nowIso, nowIso, task.id)
        .run()
      stats.autoResolved += 1
    }
  }
  return stats
}

export async function listTasks(db, { siteId = '', statuses = null, severity = '', limit = 50, offset = 0 } = {}) {
  let sql = `SELECT ${TASK_FIELDS} FROM seo_tasks WHERE 1=1`
  const binds = []
  if (siteId !== '') { sql += ' AND site_id = ?'; binds.push(siteId) }
  if (statuses && statuses.length > 0) { sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`; binds.push(...statuses) }
  if (severity !== '') { sql += ' AND severity = ?'; binds.push(severity) }
  sql += ' ORDER BY priority_score DESC, created_at ASC LIMIT ? OFFSET ?'
  binds.push(Math.min(100, limit), Math.max(0, offset))
  const { results } = await db.prepare(sql).bind(...binds).all()
  return (results ?? []).map(toTask)
}

export async function countOpenTasks(db, siteId) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS crit FROM seo_tasks WHERE site_id = ? AND status IN ('open', 'acknowledged', 'in_progress', 'reopened')`)
    .bind(siteId)
    .first()
  return { open: Number(row?.cnt ?? 0), critical: Number(row?.crit ?? 0) }
}

export async function updateTask(db, id, fields) {
  const now = new Date().toISOString()
  const map = { status: 'status', resolutionNote: 'resolution_note', assignedTo: 'assigned_to', dueDate: 'due_date', resolvedAt: 'resolved_at' }
  const sets = ['updated_at = ?']
  const binds = [now]
  for (const [key, column] of Object.entries(map)) {
    if (fields[key] === undefined) continue
    sets.push(`${column} = ?`)
    binds.push(fields[key])
  }
  await db.prepare(`UPDATE seo_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run()
  return getTask(db, id)
}

// ---------- settings ----------
export async function getSeoSettings(db, siteId) {
  const row = await db
    .prepare(`SELECT site_id, check_enabled, max_pages, stale_content_days, minimum_content_length, paused_reason, updated_at FROM site_seo_settings WHERE site_id = ?`)
    .bind(siteId)
    .first()
  if (!row) return null
  return {
    siteId: row.site_id,
    checkEnabled: row.check_enabled === 1,
    maxPages: row.max_pages ?? 0,
    staleContentDays: row.stale_content_days ?? 0,
    minimumContentLength: row.minimum_content_length ?? 0,
    pausedReason: row.paused_reason ?? '',
    updatedAt: row.updated_at,
  }
}

export async function upsertSeoSettings(db, siteId, settings) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO site_seo_settings (site_id, check_enabled, max_pages, stale_content_days, minimum_content_length, paused_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET check_enabled = excluded.check_enabled, max_pages = excluded.max_pages,
         stale_content_days = excluded.stale_content_days, minimum_content_length = excluded.minimum_content_length,
         paused_reason = excluded.paused_reason, updated_at = excluded.updated_at`
    )
    .bind(siteId, settings.checkEnabled === false ? 0 : 1, settings.maxPages ?? 0, settings.staleContentDays ?? 0, settings.minimumContentLength ?? 0, settings.pausedReason ?? '', now)
    .run()
  return getSeoSettings(db, siteId)
}
