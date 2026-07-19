// ============================================================
// SEO 검사 공통 로직
//
// check-seo.mjs(빌드 전 검사)와 create-site.mjs(사이트 생성 후 검사)가
// 같은 규칙을 재사용합니다. 검사 규칙은 이 파일 한 곳에만 존재합니다.
//
// runSeoCheck(hospital, siteId, { print })
//   → { errors: [...], warnings: [...], counts: {...} }
//
// 이 모듈은 process.exit를 호출하지 않습니다. (종료 처리는 호출한 쪽 책임)
// 외부 라이브러리와 Astro 기능을 사용하지 않는 순수 Node 코드입니다.
// ============================================================

import { normalizeSiteUrl } from '../../src/lib/site-url.js'

// ---------- 출력 도우미 (ANSI 컬러, 외부 라이브러리 없음) ----------
const supportsColor = process.stdout.isTTY || process.env.FORCE_COLOR
const paint = (code, text) => (supportsColor ? `\x1b[${code}m${text}\x1b[0m` : text)
export const green = (t) => paint('32', t)
export const yellow = (t) => paint('33', t)
export const red = (t) => paint('31', t)
export const bold = (t) => paint('1', t)

// ---------- 공통 판별 ----------
const isFilled = (v) => typeof v === 'string' && v.trim() !== ''
const isReal = (v) => isFilled(v) && v.trim() !== '미정'
const len = (v) => (typeof v === 'string' ? v.trim().length : 0)

// 권장 길이 (한글 사이트 기준, 단순 문자 수)
const TITLE_MIN = 15, TITLE_MAX = 60
const DESC_MIN = 50, DESC_MAX = 160
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function runSeoCheck(hospital, siteId, { print = true } = {}) {
  const errors = []
  const warnings = []

  const log = (msg) => { if (print) console.log(msg) }
  const ok = (msg) => log(`  ${green('✓')} ${msg}`)
  const warn = (msg) => { warnings.push(msg); log(`  ${yellow('⚠')} ${msg}`) }
  const fail = (msg) => { errors.push(msg); log(`  ${red('✕')} ${msg}`) }

  log(bold('\nSEO 검사 시작'))
  log(`대상 사이트: ${siteId}\n`)

  // ============================================================
  // [A] 사이트 공통 설정 검사
  // ============================================================
  log(bold('[공통 설정]'))

  // 사이트명
  if (isFilled(hospital.name)) ok(`사이트명: "${hospital.name}"`)
  else fail('사이트명(name)이 비어 있습니다')

  // 사이트 URL
  let siteUrl = null
  if (!isFilled(hospital.site?.url)) {
    fail('site.url이 없습니다 — canonical/OG/sitemap을 만들 수 없습니다')
  } else {
    try {
      siteUrl = normalizeSiteUrl(hospital.site.url)
      ok(`사이트 URL: ${siteUrl}`)
      if (hospital.site.url.trim() !== siteUrl) {
        warn(`site.url 끝에 불필요한 슬래시가 있습니다 ("${hospital.site.url}") — 빌드 시 "${siteUrl}"로 자동 정규화됩니다`)
      }
    } catch (e) {
      fail(`site.url이 잘못되었습니다: ${e.message}`)
    }
  }

  // 기본 설명 (모든 페이지의 기본 meta description)
  if (isFilled(hospital.description)) {
    ok('기본 설명(description) 있음')
    const l = len(hospital.description)
    if (l < DESC_MIN || l > DESC_MAX) {
      warn(`기본 설명 길이 ${l}자 — 권장 ${DESC_MIN}~${DESC_MAX}자`)
    }
  } else {
    fail('기본 설명(description)이 비어 있습니다')
  }

  // 현재 구조상 화면·JSON-LD에 쓰이는 값 (미정이면 경고)
  if (isReal(hospital.phone)) ok('전화번호 있음')
  else warn('전화번호(phone)가 "미정"입니다 — 구조화 데이터에서 제외되는 중')

  if (isReal(hospital.address)) ok('주소 있음')
  else warn('주소(address)가 "미정"입니다 — 구조화 데이터에서 제외되는 중')

  // 화면 출력에 반드시 필요한 구조 (없으면 빌드가 깨짐)
  for (const [path, label] of [
    ['hero.title', 'Hero 제목'],
    ['cta.label', '상담 버튼 문구'],
    ['hours.weekday', '운영시간(평일)'],
    ['hours.saturday', '운영시간(토요일)'],
    ['hours.sundayHoliday', '운영시간(일·공휴일)'],
  ]) {
    const value = path.split('.').reduce((o, k) => o?.[k], hospital)
    if (isFilled(value)) ok(`${label} 있음`)
    else fail(`${label}(${path})이 없습니다 — 페이지 렌더링이 깨집니다`)
  }

  // 로고 / 대표(OG) 이미지
  if (isReal(hospital.images?.logo)) ok(`로고: ${hospital.images.logo}`)
  else warn('로고(images.logo)가 설정되지 않았습니다 — 텍스트 로고로 표시되는 중 (OG 대표 이미지도 없음)')

  // ============================================================
  // [B] 콘텐츠 검사
  // ============================================================
  log(bold('\n[콘텐츠]'))

  // ---- 아티클 (각 글이 /articles/{slug} 독립 페이지가 됨) ----
  const articles = Array.isArray(hospital.articles) ? hospital.articles : []
  const slugSeen = new Map()
  const titleSeen = new Map()

  articles.forEach((a, i) => {
    const where = `articles[${i}]${a.slug ? ` (/articles/${a.slug})` : ''}`

    // slug: 없거나 형식이 틀리면 URL을 못 만들므로 오류
    if (!isFilled(a.slug)) fail(`${where}: slug가 없습니다 — 페이지 URL을 만들 수 없습니다`)
    else if (!SLUG_PATTERN.test(a.slug.trim())) fail(`${where}: slug "${a.slug}" 형식이 잘못되었습니다 (소문자·숫자·하이픈만)`)
    else if (slugSeen.has(a.slug)) fail(`${where}: slug "${a.slug}" 중복 — articles[${slugSeen.get(a.slug)}]와 같은 URL이 됩니다`)
    else slugSeen.set(a.slug, i)

    // title
    if (!isFilled(a.title)) fail(`${where}: title이 없습니다`)
    else {
      const l = len(a.title)
      if (l < TITLE_MIN || l > TITLE_MAX) warn(`${where}: title 길이 ${l}자 — 권장 ${TITLE_MIN}~${TITLE_MAX}자`)
      if (titleSeen.has(a.title)) warn(`${where}: title "${a.title}" 중복 (articles[${titleSeen.get(a.title)}])`)
      else titleSeen.set(a.title, i)
    }

    // summary = 상세 페이지의 meta description
    if (!isFilled(a.summary)) fail(`${where}: summary(설명)가 없습니다 — meta description이 비게 됩니다`)
    else {
      const l = len(a.summary)
      if (l < DESC_MIN || l > DESC_MAX) warn(`${where}: summary 길이 ${l}자 — 권장 ${DESC_MIN}~${DESC_MAX}자`)
    }

    // content: 없으면 상세 페이지 렌더링이 깨짐
    if (!Array.isArray(a.content) || a.content.length === 0 || a.content.every((p) => !isFilled(p))) {
      fail(`${where}: 본문(content)이 비어 있습니다 — 상세 페이지가 깨집니다`)
    }

    // date
    if (!isFilled(a.date)) warn(`${where}: 작성일(date)이 없습니다`)

    // canonical 생성 가능 여부 (site.url + slug 둘 다 유효해야 함)
    if (siteUrl && isFilled(a.slug) && SLUG_PATTERN.test(a.slug.trim())) {
      ok(`${where}: canonical 생성 가능 → ${siteUrl}/articles/${a.slug}/`)
    }
  })
  if (articles.length === 0) warn('아티클이 0개입니다 — 검색 유입 콘텐츠가 없습니다')

  // ---- 진료과목 ----
  const services = Array.isArray(hospital.services) ? hospital.services : []
  const svcSlugSeen = new Map()
  services.forEach((s, i) => {
    const where = `services[${i}]`
    if (!isFilled(s.title)) fail(`${where}: title이 없습니다`)
    if (!isFilled(s.summary)) warn(`${where}: summary가 비어 있습니다`)
    if (isFilled(s.slug)) {
      if (svcSlugSeen.has(s.slug)) fail(`${where}: slug "${s.slug}" 중복`)
      else svcSlugSeen.set(s.slug, i)
    }
  })
  if (services.length === 0) warn('진료과목이 0개입니다')

  // ---- FAQ (FAQPage 구조화 데이터로 출력됨) ----
  const faq = Array.isArray(hospital.faq) ? hospital.faq : []
  faq.forEach((f, i) => {
    if (!isFilled(f.question)) fail(`faq[${i}]: 질문이 비어 있습니다 — FAQ 구조화 데이터가 잘못 출력됩니다`)
    if (!isFilled(f.answer)) fail(`faq[${i}]: 답변이 비어 있습니다 — FAQ 구조화 데이터가 잘못 출력됩니다`)
  })
  if (faq.length === 0) warn('FAQ가 0개입니다 — FAQ 구조화 데이터가 비게 됩니다')

  // ============================================================
  // 결과 요약
  // ============================================================
  log(bold('\n결과'))
  log(`  검사 항목: 공통 설정 + 아티클 ${articles.length}개 + 진료과목 ${services.length}개 + FAQ ${faq.length}개`)
  log(`  ${red(`오류 ${errors.length}개`)} / ${yellow(`경고 ${warnings.length}개`)}\n`)

  return {
    errors,
    warnings,
    counts: { articles: articles.length, services: services.length, faq: faq.length },
  }
}
