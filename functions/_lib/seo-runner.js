// ============================================================
// SEO Check Runner — 페이지 수집 → 규칙 실행 → 점수 → 기록 (Phase 16)
//
// 안전 제한: 같은 도메인만, 최대 페이지 SEO_CHECK_MAX_PAGES(기본 6, 상한 12),
// 페이지당 SEO_CHECK_PAGE_TIMEOUT_MS(기본 8초), 전체 SEO_CHECK_TOTAL_TIMEOUT_MS
// (기본 40초). 외부 링크(예약 URL)는 존재 확인 1건으로 제한.
// HTML 파싱은 Phase 14B의 import-html 모듈을 재사용합니다(중복 구현 금지).
// 테스트 전용 재정의: SEO_CHECK_BASE_URL (실서버 미설정)
// ============================================================

import { SITE_DATA } from './site-data.generated.js'
import { extractTitle, extractMetaTags, extractJsonLd, extractLinks, extractImages, htmlToText } from './import-html.js'
import { hostnameFromUrl } from './domain-validate.js'
import { getActiveConnection } from './domain-repository.js'
import { getOnboarding } from './onboarding-repository.js'
import { latestImportForSite } from './import-repository.js'
import { listDeploysForSite, lastSuccessfulDeploy } from './deploy-repository.js'
import { SEO_RULES, applyPostDeploySoftening } from './seo-rules.js'
import { computeSeoScore } from './seo-score.js'
import { findingFingerprint } from './seo-status.js'
import {
  insertRun, completeRun, failRun, getRun, applyDetections, resolveClearedFindings, syncTasks, getSeoSettings,
} from './seo-repository.js'

function limits(env, settings) {
  const clamp = (value, fallback, max) => {
    const n = Number(value)
    return n > 0 ? Math.min(max, n) : fallback
  }
  return {
    maxPages: clamp(settings?.maxPages || env?.SEO_CHECK_MAX_PAGES, 6, 12),
    pageTimeoutMs: clamp(env?.SEO_CHECK_PAGE_TIMEOUT_MS, 8000, 30000),
    totalTimeoutMs: clamp(env?.SEO_CHECK_TOTAL_TIMEOUT_MS, 40000, 120000),
    staleDays: clamp(settings?.staleContentDays || env?.SEO_CHECK_STALE_DAYS, 60, 365),
    minWords: clamp(settings?.minimumContentLength || env?.SEO_CONTENT_MIN_WORDS, 300, 5000),
  }
}

function buildUrl(env, host, path) {
  const override = typeof env?.SEO_CHECK_BASE_URL === 'string' ? env.SEO_CHECK_BASE_URL.trim() : ''
  return override !== '' ? `${override.replace(/\/$/, '')}/${host}${path}` : `https://${host}${path}`
}

async function fetchRaw(env, host, path, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(buildUrl(env, host, path), {
      redirect: 'follow', signal: controller.signal,
      headers: { accept: 'text/html,application/xml,text/plain', 'user-agent': 'aiseolab-seo-check/1.0' },
    })
    const text = await response.text().catch(() => '')
    return { ok: response.status === 200, status: response.status, text: text.slice(0, 600_000), bytes: text.length }
  } catch (e) {
    return { ok: false, status: 0, text: '', bytes: 0, error: e?.name === 'AbortError' ? '응답 시간 초과' : /redirect/i.test(String(e?.message)) ? '리디렉션 루프/횟수 초과' : '연결 실패' }
  } finally {
    clearTimeout(timer)
  }
}

// HTML → 규칙 입력용 페이지 객체 (원본 HTML은 보관하지 않음)
function parsePage(url, path, raw, { isContent = false } = {}) {
  if (!raw.ok) return { url, path, ok: false, status: raw.status, error: raw.error, images: [], links: [], jsonLd: [], meta: {}, text: '', textLength: 0 }
  const html = raw.text
  const text = htmlToText(html).slice(0, 20_000)
  return {
    url, path, ok: true, status: raw.status, isContent,
    title: extractTitle(html),
    meta: extractMetaTags(html),
    jsonLd: extractJsonLd(html),
    links: extractLinks(html, url),
    images: extractImages(html, url),
    text,
    textLength: text.replace(/\s/g, '').length,
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    hasViewport: /<meta[^>]*name\s*=\s*["']viewport["']/i.test(html),
    canonical: (html.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i) ?? html.match(/<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i) ?? [])[1] ?? '',
    hasNoindex: /<meta[^>]*name\s*=\s*["']robots["'][^>]*noindex/i.test(html),
    hasTelLink: /href\s*=\s*["']tel:/i.test(html),
    bytes: raw.bytes,
  }
}

// sitemap에서 우선순위 경로 선택 (진료과 → 의료진 → 콘텐츠 순)
export function pickCheckPaths(sitemapLocs, host, maxExtra) {
  const paths = []
  const seen = new Set(['/'])
  const priorities = [/^\/departments\/$/, /^\/doctors\/$/, /^\/doctors\/[^/]+\/$/, /^\/departments\/[^/]+\/$/, /^\/articles\/[^/]+\/$/, /^\/articles\/?$/, /^\/faq\/?$/]
  const candidates = []
  for (const loc of sitemapLocs) {
    try {
      const url = new URL(loc)
      if (url.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) continue
      const path = url.pathname
      const rank = priorities.findIndex((pattern) => pattern.test(path))
      if (rank >= 0) candidates.push({ path, rank })
    } catch { /* 무시 */ }
  }
  candidates.sort((a, b) => a.rank - b.rank)
  for (const { path } of candidates) {
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= maxExtra) break
  }
  return paths
}

// 메인 진입점 — run 기록을 생성·완료까지 책임짐. 반환: { run }
export async function runSeoCheck(env, db, siteId, { triggerType = 'manual' } = {}) {
  const runId = `run_${crypto.randomUUID()}`
  await insertRun(db, { id: runId, siteId, triggerType })
  try {
    const settings = await getSeoSettings(db, siteId).catch(() => null)
    const config = limits(env, settings)
    const bundle = SITE_DATA[siteId] ?? null
    const connection = await getActiveConnection(db, siteId).catch(() => null)
    const onboarding = await getOnboarding(db, siteId).catch(() => null)
    const importJob = await latestImportForSite(db, siteId).catch(() => null)
    const deployHistory = await listDeploysForSite(db, siteId, 10).catch(() => [])
    const lastSuccess = await lastSuccessfulDeploy(db, siteId).catch(() => null)
    const recentFailure = deployHistory.find(
      (job) => ['production', 'replace'].includes(job.deploymentType) && job.status === 'failed' &&
        (!lastSuccess || job.createdAt > lastSuccess.createdAt)
    ) ?? null

    const host = connection?.domain || hostnameFromUrl(bundle?.site?.url ?? '')
    if (!host) {
      await failRun(db, runId, 'no_operating_url', '운영 URL이 없습니다. 도메인 탭에서 도메인을 등록·검증해 주세요.')
      return { run: await getRun(db, runId) }
    }

    const deadline = Date.now() + config.totalTimeoutMs
    const budgetLeft = () => Math.max(1000, deadline - Date.now())

    // 1) 대표 페이지 + robots + sitemap
    const pages = []
    pages.push(parsePage(`https://${host}/`, '/', await fetchRaw(env, host, '/', config.pageTimeoutMs)))
    const robotsRaw = await fetchRaw(env, host, '/robots.txt', Math.min(config.pageTimeoutMs, budgetLeft()))
    const robots = {
      ok: robotsRaw.ok,
      disallowAll: robotsRaw.ok && /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*($|\n)/i.test(robotsRaw.text),
    }
    const sitemapRaw = await fetchRaw(env, host, '/sitemap.xml', Math.min(config.pageTimeoutMs, budgetLeft()))
    const sitemapLocs = sitemapRaw.ok ? [...sitemapRaw.text.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim()) : []
    const sitemap = { ok: sitemapRaw.ok && /<(urlset|sitemapindex)/i.test(sitemapRaw.text), urlCount: sitemapLocs.length }

    // 2) 우선순위 페이지 (제한 수집)
    const extraPaths = pages[0].ok ? pickCheckPaths(sitemapLocs, host, config.maxPages - 1) : []
    for (const path of extraPaths) {
      if (Date.now() > deadline) break
      const raw = await fetchRaw(env, host, path, Math.min(config.pageTimeoutMs, budgetLeft()))
      pages.push(parsePage(`https://${host}${path}`, path, raw, { isContent: /^\/articles\/[^/]+\/$/.test(path) }))
    }

    // 3) 내부 링크 표본 확인 (대표 페이지 링크 중 최대 5개)
    let brokenLinks = null
    let checkedLinkCount = 0
    if (pages[0].ok) {
      brokenLinks = []
      const fetched = new Set(pages.map((page) => page.path))
      const sample = pages[0].links
        .filter((link) => { try { const u = new URL(link.url); return u.hostname.replace(/^www\./, '') === host.replace(/^www\./, '') && !fetched.has(u.pathname) } catch { return false } })
        .slice(0, 5)
      for (const link of sample) {
        if (Date.now() > deadline) break
        const path = new URL(link.url).pathname
        const raw = await fetchRaw(env, host, path, Math.min(config.pageTimeoutMs, budgetLeft()))
        checkedLinkCount += 1
        if (!raw.ok && raw.status >= 400) brokenLinks.push({ url: link.url, path, status: raw.status })
      }
    }

    // 4) 예약 URL 존재 확인 (외부 링크 1건 제한)
    let bookingCheck = null
    const bookingUrl = bundle?.channels?.naverBooking
    if (typeof bookingUrl === 'string' && /^https?:\/\//.test(bookingUrl) && Date.now() < deadline) {
      try {
        const target = new URL(bookingUrl)
        const raw = await fetchRaw(env, target.hostname, target.pathname + target.search, Math.min(config.pageTimeoutMs, budgetLeft()))
        bookingCheck = { url: bookingUrl, ok: raw.status > 0 && raw.status < 400, status: raw.status }
      } catch {
        bookingCheck = { url: bookingUrl, ok: false, status: 0 }
      }
    }

    // 5) 규칙 실행
    const now = Date.now()
    const isPostDeploy = triggerType === 'post_deploy'
    const afterRecentDeploy = !!(lastSuccess && now - Date.parse(lastSuccess.completedAt ?? 0) < 3 * 86_400_000)
    const ctx = {
      siteId, host, bundle, connection, onboarding, importJob,
      deploys: { lastSuccess, recentFailure }, pages, robots, sitemap,
      brokenLinks, checkedLinkCount, bookingCheck, config, now, isPostDeploy,
    }
    const ruleResults = []
    const detections = []
    for (const rule of SEO_RULES) {
      let result
      try {
        result = applyPostDeploySoftening(rule.key, rule.run(ctx), isPostDeploy)
      } catch (e) {
        result = { status: 'skipped', detail: `규칙 실행 오류: ${String(e?.message ?? e).slice(0, 80)}` }
      }
      ruleResults.push({ ruleKey: rule.key, category: rule.category, label: rule.label, weight: rule.weight, status: result.status, detail: String(result.detail ?? '').slice(0, 300) })
      if (result.status === 'fail' || result.status === 'warning') {
        const severity = result.status === 'fail' ? rule.severity : (rule.warnSeverity ?? (rule.severity === 'critical' ? 'high' : 'low'))
        detections.push({
          fingerprint: findingFingerprint(siteId, rule.key, rule.sitewide ? '' : result.affectedUrl ?? ''),
          category: rule.category, ruleKey: rule.key, severity,
          title: rule.label, description: String(result.detail ?? '').slice(0, 400),
          affectedUrl: result.affectedUrl ?? '', detectedValue: String(result.detected ?? '').slice(0, 200),
          expectedValue: String(result.expected ?? '').slice(0, 200),
          evidence: { rule: rule.key, status: result.status }, isOpportunity: rule.opportunity === true,
        })
      }
    }

    // 6) 점수 + finding·task 반영
    const score = computeSeoScore(ruleResults)
    const evaluatedRuleKeys = ruleResults.filter((r) => r.status !== 'skipped').map((r) => r.ruleKey)
    const applied = await applyDetections(db, siteId, runId, detections)
    const resolvedFindings = await resolveClearedFindings(db, siteId, evaluatedRuleKeys, detections.map((d) => d.fingerprint))
    const taskStats = await syncTasks(db, {
      activeFindings: applied.activeFindings.filter((f) => f && ['open', 'reopened', 'acknowledged', 'in_progress'].includes(f.status)),
      resolvedFindings, rules: SEO_RULES, afterRecentDeploy, now,
    })

    const pagesFailed = pages.filter((page) => !page.ok).length
    const criticalCount = detections.filter((d) => d.severity === 'critical').length
    await completeRun(db, runId, {
      status: pagesFailed > 0 ? 'partial_success' : 'completed',
      pagesChecked: pages.length, pagesFailed,
      overallScore: score.overall,
      scores: {
        technical: score.categories.technical.score, content: score.categories.content.score,
        entity: score.categories.entity.score, conversion: score.categories.conversion.score,
        operations: score.categories.operations.score,
      },
      findingsCount: detections.length, criticalCount,
      warningCount: detections.filter((d) => ['medium', 'low'].includes(d.severity)).length,
      result: {
        grade: score.grade, ruleResults,
        pages: pages.map((page) => ({ path: page.path, ok: page.ok, status: page.status })),
        findingStats: { created: applied.created, updated: applied.updated, reopened: applied.reopened, autoResolved: resolvedFindings.length },
        taskStats,
      },
    })
    return { run: await getRun(db, runId) }
  } catch (e) {
    console.error(`[SEO 점검] 실패 site=${siteId}: ${e?.message ?? e}`)
    await failRun(db, runId, 'check_error', '점검 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.').catch(() => {})
    return { run: await getRun(db, runId) }
  }
}
