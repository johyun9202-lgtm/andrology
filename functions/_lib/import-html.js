// ============================================================
// Import HTML 유틸 — URL 정규화 · HTML/JSON-LD 파싱 · 텍스트 정규화 (Phase 14B)
//
// 전부 순수 함수입니다 (네트워크·환경 의존 없음 → 단위 테스트 대상).
// 외부 파서 라이브러리 없이 동작하도록 보수적인 정규식 기반으로 구현했습니다.
// (Workers의 HTMLRewriter는 Node 테스트 환경에 없어 사용하지 않습니다)
// ============================================================

// ---------- URL ----------

// 추적 파라미터는 정규화 시 제거 (같은 페이지 중복 방문 방지)
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igshid)/

// 절대 URL 정규화: http/https만, fragment 제거, 추적 파라미터 제거,
// 나머지 query는 정렬(순서 차이로 인한 중복 제거), 호스트 소문자.
// 실패 시 null.
export function normalizeImportUrl(rawUrl, baseUrl) {
  let url
  try {
    url = baseUrl ? new URL(String(rawUrl), baseUrl) : new URL(String(rawUrl))
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key.toLowerCase()))
  kept.sort(([a], [b]) => a.localeCompare(b))
  url.search = ''
  for (const [key, value] of kept) url.searchParams.append(key, value)
  url.hostname = url.hostname.toLowerCase()
  return url.toString()
}

// www 유무만 다른 호스트는 같은 사이트로 취급
function coreHost(hostname) {
  return String(hostname).toLowerCase().replace(/^www\./, '')
}

export function isSameSite(urlA, urlB) {
  try {
    return coreHost(new URL(urlA).hostname) === coreHost(new URL(urlB).hostname)
  } catch {
    return false
  }
}

// ---------- SSRF 가드 ----------
// 사용자 입력 URL을 서버에서 fetch하므로 내부망·로컬 주소를 차단합니다.
// allowHosts: 테스트용 추가 허용 목록 (env.IMPORT_ALLOW_HOSTS, "host:port" 형식)
export function isForbiddenTarget(urlString, allowHosts = []) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return '올바른 URL이 아닙니다.'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'http/https 주소만 지원합니다.'
  const host = url.hostname.toLowerCase()
  const hostPort = url.port ? `${host}:${url.port}` : host
  if (allowHosts.includes(hostPort) || allowHosts.includes(host)) return null

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return '내부 주소는 사용할 수 없습니다.'
  }
  // IPv4 리터럴 사설/특수 대역
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return '내부/사설 IP 주소는 사용할 수 없습니다.'
    }
  }
  // IPv6 리터럴 (::1, fc00::/7, fe80::/10 등) — 전부 차단(병원 홈페이지에 불필요)
  if (host.includes(':')) return 'IPv6 리터럴 주소는 지원하지 않습니다.'
  // 비표준 포트 차단 (기본 80/443만)
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return '표준 포트(80/443)가 아닌 주소는 사용할 수 없습니다.'
  }
  return null
}

// ---------- HTML → 텍스트 ----------

const BASIC_ENTITIES = [
  [/&nbsp;/gi, ' '], [/&amp;/gi, '&'], [/&lt;/gi, '<'], [/&gt;/gi, '>'],
  [/&quot;/gi, '"'], [/&#0?39;|&apos;/gi, "'"], [/&middot;/gi, '·'],
]

export function decodeEntities(text) {
  let out = String(text ?? '')
  for (const [pattern, replacement] of BASIC_ENTITIES) out = out.replace(pattern, replacement)
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code)
    return n > 31 && n < 65536 ? String.fromCharCode(n) : ' '
  })
  return out
}

// 블록 요소 경계를 줄바꿈으로 보존하며 태그 제거 (진료시간 등 줄 단위 추출용)
export function htmlToText(html) {
  let text = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/th|\/td|\/dt|\/dd)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
  return text
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

export function extractTitle(html) {
  const match = String(html ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : ''
}

// meta name/property → content
export function extractMetaTags(html) {
  const out = {}
  const tagPattern = /<meta\s[^>]*>/gi
  for (const tag of String(html ?? '').match(tagPattern) ?? []) {
    const key = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) ?? [])[1]
    const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) ?? [])[1]
    if (key && content !== undefined) out[key.toLowerCase()] = decodeEntities(content).trim()
  }
  return out
}

// <script type="application/ld+json"> 블록 전체 파싱 (@graph·배열 평탄화)
export function extractJsonLd(html) {
  const blocks = []
  const pattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const items = Array.isArray(parsed) ? parsed : parsed?.['@graph'] && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]
      for (const item of items) {
        if (item && typeof item === 'object') blocks.push(item)
      }
    } catch {
      // 잘못된 JSON-LD는 무시 (오류 아님)
    }
  }
  return blocks
}

// <a href> 목록 — 절대 URL 정규화 + 중복 제거, 앵커 텍스트 포함
export function extractLinks(html, baseUrl) {
  const seen = new Set()
  const links = []
  const pattern = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const href = decodeEntities(match[1]).trim()
    if (href.startsWith('tel:') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
      if (href.startsWith('tel:')) links.push({ url: href, text: '' })
      continue
    }
    const url = normalizeImportUrl(href, baseUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)
    links.push({ url, text: htmlToText(match[2]).replace(/\n/g, ' ').trim().slice(0, 80) })
  }
  return links
}

// <img> 목록 — src 절대화 + alt, 중복 제거
export function extractImages(html, baseUrl) {
  const seen = new Set()
  const images = []
  for (const tag of String(html ?? '').match(/<img\s[^>]*>/gi) ?? []) {
    const src = (tag.match(/src\s*=\s*["']([^"']+)["']/i) ?? [])[1]
    if (!src || src.startsWith('data:')) continue
    const url = normalizeImportUrl(decodeEntities(src).trim(), baseUrl)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const alt = decodeEntities((tag.match(/alt\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? '').trim()
    const attrs = ((tag.match(/(?:class|id)\s*=\s*["']([^"']*)["']/gi) ?? []).join(' ')).toLowerCase()
    images.push({ url, alt, attrs })
  }
  return images
}

// ---------- 전화번호 ----------

// 숫자만 남긴 뒤 한국 전화번호 형식으로 하이픈 정규화. 실패 시 ''
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '')
  if (/^1[568]\d{2}\d{4}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}` // 1588-1234형
  if (/^02\d{7,8}$/.test(digits)) {
    return digits.length === 9
      ? `02-${digits.slice(2, 5)}-${digits.slice(5)}`
      : `02-${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  if (/^0\d{2}\d{7,8}$/.test(digits) && !digits.startsWith('010')) {
    return digits.length === 10
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  return ''
}

// 페이지에서 대표번호 후보 추출 (tel: 링크 우선, 다음 텍스트 패턴)
export function findPhones(html) {
  const found = []
  const seen = new Set()
  const push = (raw, confidence) => {
    const phone = normalizePhone(raw)
    if (phone && !seen.has(phone)) {
      seen.add(phone)
      found.push({ phone, confidence })
    }
  }
  for (const tag of String(html ?? '').match(/href\s*=\s*["']tel:([^"']+)["']/gi) ?? []) {
    push((tag.match(/tel:([^"']+)/i) ?? [])[1], 'high')
  }
  const text = htmlToText(html)
  for (const raw of text.match(/(?:0\d{1,2}|1[568]\d{2})[-.) ]?\d{3,4}[-. ]?\d{4}/g) ?? []) {
    push(raw, 'medium')
  }
  return found
}

// ---------- 진료시간 ----------

const TIME_RANGE = /(?:오전|오후|AM|PM)?\s*\d{1,2}[:시]\s*\d{0,2}\s*분?\s*[~\-–]\s*(?:오전|오후|AM|PM)?\s*\d{1,2}[:시]\s*\d{0,2}\s*분?/

// 줄 단위 텍스트에서 평일/토요일/일·공휴일 진료시간 추출 (근거 줄 포함)
export function extractHoursFromText(text) {
  const out = {}
  const rules = [
    ['weekday', /평일|월\s*[~\-–]\s*금|월요일\s*[~\-–]\s*금요일/],
    ['saturday', /토요일|^토\b|\b토\s/],
    ['sundayHoliday', /일요일|공휴일|일\s*[·,/]\s*공휴일/],
  ]
  for (const line of String(text ?? '').split('\n')) {
    for (const [key, dayPattern] of rules) {
      if (out[key]) continue
      if (!dayPattern.test(line)) continue
      if (/휴진|휴무|휴원/.test(line)) {
        out[key] = { value: '휴진', sourceText: line.slice(0, 120) }
        continue
      }
      const time = line.match(TIME_RANGE)
      if (time) {
        out[key] = { value: time[0].replace(/\s+/g, ' ').trim(), sourceText: line.slice(0, 120) }
      }
    }
  }
  return out
}

// ---------- robots.txt ----------

// User-agent: * 그룹의 Disallow 경로 목록 (보수적: Allow는 해석하지 않음)
export function parseRobots(robotsText) {
  const disallows = []
  let applies = false
  for (const rawLine of String(robotsText ?? '').split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue
    const [rawKey, ...rest] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      applies = value === '*'
    } else if (key === 'disallow' && applies && value !== '') {
      disallows.push(value)
    }
  }
  return disallows
}

export function isPathAllowed(disallows, pathname) {
  const path = String(pathname ?? '/')
  return !(disallows ?? []).some((prefix) => path.startsWith(prefix))
}
