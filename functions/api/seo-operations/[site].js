// /api/seo-operations/<siteId> — 병원별 SEO 운영 상세(GET) / 점검 설정(PUT) (Phase 16)

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { getOnboarding } from '../../_lib/onboarding-repository.js'
import { getActiveConnection } from '../../_lib/domain-repository.js'
import { lastSuccessfulDeploy } from '../../_lib/deploy-repository.js'
import {
  latestRunForSite, listRunsForSite, listFindings, listTasks, countOpenTasks, getSeoSettings, upsertSeoSettings,
} from '../../_lib/seo-repository.js'
import { classifySiteOperability, siteStatusFromScore, SEVERITY_LABELS, CATEGORY_LABELS, SITE_STATUS_LABELS } from '../../_lib/seo-status.js'

const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function resolveSeoSite(db, site) {
  const siteId = String(site ?? '')
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length > 30) return { error: 'siteId가 올바르지 않습니다.', status: 400 }
  const onboarding = await getOnboarding(db, siteId).catch(() => null)
  if (!ALLOWED_SITES.includes(siteId) && !onboarding) return { error: `등록되지 않은 사이트입니다: "${siteId}"`, status: 404 }
  return { siteId, onboarding }
}

// 사이트 분류에 필요한 데이터 일괄 조회 (overview·run에서 재사용)
export async function siteOperabilityContext(db, siteId, onboarding) {
  const [connection, lastSuccess, settings] = await Promise.all([
    getActiveConnection(db, siteId).catch(() => null),
    lastSuccessfulDeploy(db, siteId).catch(() => null),
    getSeoSettings(db, siteId).catch(() => null),
  ])
  const classification = classifySiteOperability({ onboarding, connection, hasProductionSuccess: !!lastSuccess, settings })
  return { connection, lastSuccess, settings, classification }
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveSeoSite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  try {
    const { connection, lastSuccess, settings, classification } = await siteOperabilityContext(db, resolved.siteId, resolved.onboarding)
    const [latestRun, runs, findings, tasks, openCounts] = await Promise.all([
      latestRunForSite(db, resolved.siteId, { includeResult: true }),
      listRunsForSite(db, resolved.siteId, 10),
      listFindings(db, resolved.siteId, { statuses: ['open', 'acknowledged', 'in_progress', 'reopened', 'ignored'], limit: 100 }),
      listTasks(db, { siteId: resolved.siteId, statuses: ['open', 'acknowledged', 'in_progress', 'reopened'], limit: 50 }),
      countOpenTasks(db, resolved.siteId),
    ])
    const status = latestRun
      ? siteStatusFromScore(latestRun.overallScore, { checkFailed: latestRun.status === 'failed' })
      : classification.operability === 'operating' ? 'unchecked' : classification.operability
    return jsonResponse({
      ok: true,
      site: resolved.siteId,
      hospitalName: resolved.onboarding?.hospitalName ?? resolved.siteId,
      stage: resolved.onboarding?.stage ?? 'onboarding',
      operationMode: resolved.onboarding?.operationMode ?? 'independent',
      operatingUrl: connection?.domain ? `https://${connection.domain}` : '',
      classification,
      status,
      latestRun,
      runs,
      findings,
      tasks,
      openCounts,
      lastSuccessDeploy: lastSuccess ? { completedAt: lastSuccess.completedAt, productionUrl: lastSuccess.productionUrl } : null,
      settings: settings ?? { siteId: resolved.siteId, checkEnabled: true, maxPages: 0, staleContentDays: 0, minimumContentLength: 0, pausedReason: '' },
      labels: { severity: SEVERITY_LABELS, category: CATEGORY_LABELS, siteStatus: SITE_STATUS_LABELS },
    })
  } catch (e) {
    console.error(`[SEO 상세] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: 'SEO 운영 정보를 불러오지 못했습니다. (0009 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const body = await readJsonBody(context.request, 5_000)
  if (body === null || typeof body !== 'object') return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveSeoSite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const clampInt = (value, max) => {
    const n = Number(value)
    return Number.isInteger(n) && n >= 0 && n <= max ? n : 0
  }
  try {
    const settings = await upsertSeoSettings(db, resolved.siteId, {
      checkEnabled: body.checkEnabled !== false,
      maxPages: clampInt(body.maxPages, 12),
      staleContentDays: clampInt(body.staleContentDays, 365),
      minimumContentLength: clampInt(body.minimumContentLength, 5000),
      pausedReason: String(body.pausedReason ?? '').slice(0, 200),
    })
    return jsonResponse({ ok: true, settings })
  } catch (e) {
    console.error(`[SEO 설정] 저장 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '설정을 저장하지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
