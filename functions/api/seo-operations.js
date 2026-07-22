// /api/seo-operations — 전체 병원 운영 현황판 (Phase 16)
//
// 운영 중 사이트 + 준비 단계 사이트를 함께 표시하되 상태로 구분합니다.
// 지표는 실제 점검·배포 기록만으로 계산하며 추정값을 만들지 않습니다.

import { jsonResponse, methodNotAllowed, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { listOnboarding } from '../_lib/onboarding-repository.js'
import { listRecentDeploys } from '../_lib/deploy-repository.js'
import { latestRunForSite, countOpenTasks, listTasks, recentRunStats, listFindings } from '../_lib/seo-repository.js'
import { siteStatusFromScore, SEVERITY_LABELS, SITE_STATUS_LABELS } from '../_lib/seo-status.js'
import { siteOperabilityContext } from './seo-operations/[site].js'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const onboardingRecords = await listOnboarding(db).catch(() => [])
    const byId = new Map(onboardingRecords.map((record) => [record.siteId, record]))
    const siteIds = [...new Set([...ALLOWED_SITES, ...byId.keys()])].sort()

    const sites = []
    for (const siteId of siteIds) {
      const onboarding = byId.get(siteId) ?? null
      const { connection, lastSuccess, classification } = await siteOperabilityContext(db, siteId, onboarding)
      const latestRun = await latestRunForSite(db, siteId).catch(() => null)
      const openCounts = await countOpenTasks(db, siteId).catch(() => ({ open: 0, critical: 0 }))
      const openFindings = await listFindings(db, siteId, { statuses: ['open', 'reopened', 'acknowledged', 'in_progress'], limit: 50 }).catch(() => [])
      const worst = openFindings.filter((f) => !f.isOpportunity).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))[0] ?? null
      const status = latestRun
        ? siteStatusFromScore(latestRun.overallScore, { checkFailed: latestRun.status === 'failed' })
        : classification.operability === 'operating' ? 'unchecked' : classification.operability
      sites.push({
        siteId,
        hospitalName: onboarding?.hospitalName ?? siteId,
        stage: onboarding?.stage ?? 'onboarding',
        operatingUrl: connection?.domain ? `https://${connection.domain}` : '',
        operability: classification.operability,
        checkable: classification.checkable,
        reason: classification.reason,
        status,
        healthScore: latestRun?.overallScore ?? null,
        scores: latestRun?.scores ?? null,
        lastCheckedAt: latestRun?.completedAt ?? null,
        lastSuccessDeployAt: lastSuccess?.completedAt ?? null,
        openTasks: openCounts.open,
        criticalTasks: openCounts.critical,
        worstFinding: worst ? { title: worst.title, severity: worst.severity } : null,
      })
    }

    // 핵심 지표 (실측 기반)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const runStats = await recentRunStats(db, sevenDaysAgo).catch(() => [])
    const runTotal = runStats.reduce((sum, row) => sum + Number(row.cnt), 0)
    const runOk = runStats.filter((row) => ['completed', 'partial_success'].includes(row.status)).reduce((sum, row) => sum + Number(row.cnt), 0)
    const recentDeploys = (await listRecentDeploys(db, 50).catch(() => []))
      .filter((job) => ['production', 'replace'].includes(job.deploymentType) && job.createdAt >= sevenDaysAgo && !['queued', 'validating', 'building', 'deploying', 'verifying'].includes(job.status))
    const deployOk = recentDeploys.filter((job) => ['success', 'partial_success'].includes(job.status)).length
    const todayIso = new Date().toISOString().slice(0, 10)
    const openTasksAll = await listTasks(db, { statuses: ['open', 'acknowledged', 'in_progress', 'reopened'], limit: 100 }).catch(() => [])

    return jsonResponse({
      ok: true,
      metrics: {
        operatingCount: sites.filter((site) => site.operability === 'operating').length,
        healthyCount: sites.filter((site) => ['healthy', 'good'].includes(site.status)).length,
        warningCount: sites.filter((site) => site.status === 'warning').length,
        criticalCount: sites.filter((site) => ['critical', 'error', 'check_failed'].includes(site.status)).length,
        tasksCreatedToday: openTasksAll.filter((task) => task.createdAt.startsWith(todayIso)).length,
        openTasksTotal: openTasksAll.length,
        checkSuccessRate7d: runTotal > 0 ? Math.round((runOk / runTotal) * 100) : null,
        deploySuccessRate7d: recentDeploys.length > 0 ? Math.round((deployOk / recentDeploys.length) * 100) : null,
      },
      sites,
      labels: { severity: SEVERITY_LABELS, siteStatus: SITE_STATUS_LABELS },
    })
  } catch (e) {
    console.error(`[SEO 현황판] 조회 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '운영 현황을 불러오지 못했습니다. (0009 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
