// ============================================================
// Import Crawler — 기존 병원 홈페이지 제한 수집 (Phase 14B)
//
// 안전 기준:
//  - 같은 도메인(www 유무 무시)만 탐색, 외부 도메인 리디렉션 즉시 중단
//  - SSRF 가드(내부망·사설 IP·비표준 포트 차단) — import-html.isForbiddenTarget
//  - robots.txt의 User-agent:* Disallow 존중 (읽기 실패 시 허용으로 간주)
//  - 최대 페이지 수(IMPORT_MAX_PAGES, 기본 8, 상한 15) + 페이지당 timeout
//    (IMPORT_TIMEOUT_MS, 기본 8초) + 전체 시간 예산(IMPORT_BUDGET_MS, 기본 40초)
//  - 중복 URL 제거(fragment 제거·추적 파라미터 제거·query 정렬 후 비교)
//  - HTML만 처리, 페이지당 최대 1.5MB
//  - 테스트 전용: IMPORT_ALLOW_HOSTS 로 스텁 호스트 허용 (실서버 미설정)
// ============================================================

import { normalizeImportUrl, isSameSite, isForbiddenTarget, parseRobots, isPathAllowed, htmlToText, extractLinks } from './import-html.js'
import { buildCandidates, pickCrawlTargets } from './import-extractor.js'
import { computeImportScore } from './import-score.js'

export const DEFAULT_MAX_PAGES = 8
const MAX_PAGES_CAP = 15
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_BUDGET_MS = 40000
const MAX_HTML_BYTES = 1_500_000
const USER_AGENT = 'aiseolab-import-bot/1.0 (+https://aiseolab.kr)'

function limits(env) {
  const maxPages = Math.min(MAX_PAGES_CAP, Math.max(1, Number(env?.IMPORT_MAX_PAGES) || DEFAULT_MAX_PAGES))
  const timeoutMs = Math.max(1000, Number(env?.IMPORT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)
  const budgetMs = Math.max(5000, Number(env?.IMPORT_BUDGET_MS) || DEFAULT_BUDGET_MS)
  const allowHosts = String(env?.IMPORT_ALLOW_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '')
  return { maxPages, timeoutMs, budgetMs, allowHosts }
}

// 한 페이지 수집 — 실패 사유를 사람이 읽을 수 있게 분류해 반환
async function fetchPage(url, { timeoutMs, allowHosts }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    })
    const finalUrl = response.url || url
    if (!isSameSite(finalUrl, url)) {
      return { url, ok: false, error: '외부 도메인으로 이동하는 페이지입니다.' }
    }
    if (isForbiddenTarget(finalUrl, allowHosts)) {
      return { url, ok: false, error: '허용되지 않는 주소로 이동했습니다.' }
    }
    if (response.status === 401 || response.status === 403) {
      return { url, ok: false, status: response.status, error: '접근이 제한된 페이지입니다. (로그인 필요 가능성)' }
    }
    if (response.status === 404) {
      return { url, ok: false, status: 404, error: '페이지가 없습니다. (404)' }
    }
    if (!response.ok) {
      return { url, ok: false, status: response.status, error: `접속 실패 (HTTP ${response.status})` }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType !== '' && !contentType.includes('html')) {
      return { url, ok: false, error: `HTML 페이지가 아닙니다. (${contentType.split(';')[0]})` }
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_HTML_BYTES) {
      return { url, ok: false, error: '페이지가 너무 큽니다. (1.5MB 초과)' }
    }
    const html = (await response.text()).slice(0, MAX_HTML_BYTES)
    return { url, ok: true, status: response.status, html }
  } catch (e) {
    if (e?.name === 'AbortError') return { url, ok: false, error: `응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)` }
    return { url, ok: false, error: '사이트에 접속하지 못했습니다.' }
  } finally {
    clearTimeout(timer)
  }
}

// robots.txt 읽기 — 실패(404 포함)는 "제한 없음"으로 간주
async function fetchRobots(sourceUrl, options) {
  try {
    const origin = new URL(sourceUrl).origin
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs, 5000))
    const response = await fetch(`${origin}/robots.txt`, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    })
    clearTimeout(timer)
    if (!response.ok) return []
    return parseRobots(await response.text())
  } catch {
    return []
  }
}

// 메인 진입점.
// 반환: { status, sourceUrl, pages: [{url, ok, status?, error?}],
//         candidates, score, warning?, error? }
// status: completed | partial_success | failed
export async function runImportCrawl(env, rawSourceUrl) {
  const options = limits(env)
  const sourceUrl = normalizeImportUrl(rawSourceUrl)
  if (!sourceUrl) {
    return { status: 'failed', sourceUrl: String(rawSourceUrl ?? ''), pages: [], candidates: [], score: computeImportScore([]), error: 'URL 형식이 올바르지 않습니다. (http:// 또는 https:// 주소)' }
  }
  const forbidden = isForbiddenTarget(sourceUrl, options.allowHosts)
  if (forbidden) {
    return { status: 'failed', sourceUrl, pages: [], candidates: [], score: computeImportScore([]), error: forbidden }
  }

  const deadline = Date.now() + options.budgetMs
  const disallows = await fetchRobots(sourceUrl, options)
  if (!isPathAllowed(disallows, new URL(sourceUrl).pathname)) {
    return { status: 'failed', sourceUrl, pages: [], candidates: [], score: computeImportScore([]), error: '대상 사이트가 robots.txt로 수집을 제한하고 있습니다.' }
  }

  // 1) 메인 페이지
  const pages = []
  const htmlPages = []
  const main = await fetchPage(sourceUrl, options)
  pages.push({ url: main.url, ok: main.ok, status: main.status, error: main.error })
  if (!main.ok) {
    return { status: 'failed', sourceUrl, pages, candidates: [], score: computeImportScore([]), error: `메인 페이지 수집 실패 — ${main.error}` }
  }
  htmlPages.push({ url: sourceUrl, html: main.html })

  // 2) 내부 우선 페이지 (같은 도메인 + robots 허용 + 중복 제거)
  const links = extractLinks(main.html, sourceUrl)
  const targets = pickCrawlTargets(links, sourceUrl, options.maxPages - 1).filter((url) => {
    try {
      return isPathAllowed(disallows, new URL(url).pathname) && !isForbiddenTarget(url, options.allowHosts)
    } catch {
      return false
    }
  })

  for (const target of targets) {
    if (Date.now() > deadline) {
      pages.push({ url: target, ok: false, error: '시간 예산 초과로 건너뜀' })
      continue
    }
    const page = await fetchPage(target, options)
    pages.push({ url: page.url, ok: page.ok, status: page.status, error: page.error })
    if (page.ok) htmlPages.push({ url: target, html: page.html })
  }

  // 3) 추출 + 점수
  const candidates = buildCandidates(htmlPages, sourceUrl)
  const score = computeImportScore(candidates)

  // JavaScript 렌더링 사이트 감지 (본문 텍스트가 거의 없으면 안내)
  let warning
  if (htmlToText(main.html).length < 200 && candidates.length <= 2) {
    warning = 'JavaScript로 렌더링되는 사이트로 보입니다. 정적 HTML에서 추출 가능한 정보가 매우 적습니다.'
  }

  const failed = pages.filter((page) => !page.ok).length
  const status = failed === 0 ? 'completed' : 'partial_success'
  return { status, sourceUrl, pages, candidates, score, warning }
}
