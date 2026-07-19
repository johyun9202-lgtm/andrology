// ============================================================
// 아티클 입력 검증
//
// create-article CLI가 입력 JSON(아티클 객체 1개)의 "구조"를 검증합니다.
// - 구조·타입·필수값 문제 → 오류 (등록 중단)
// - SEO 권장 길이 문제 → 경고 (등록은 진행, 최종 판단은 전체 SEO 검사)
//
// 사이트 전체 SEO 검증은 scripts/lib/seo-checker.mjs 담당이며,
// 이 파일은 입력 아티클 1개의 구조 검증만 담당합니다. (규칙 중복 없음)
// ============================================================

// 기존 articles 구조 기준 필드: slug, title, summary, date, content
const KNOWN_KEYS = ['slug', 'title', 'summary', 'date', 'content']

// seo-checker와 동일한 기준
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TITLE_MIN = 15, TITLE_MAX = 60
const DESC_MIN = 50, DESC_MAX = 160
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 위험한 HTML/스크립트 패턴 (본문은 일반 텍스트 기반이므로 발견 시 오류)
const DANGEROUS_PATTERNS = [/<script/i, /javascript:/i, /onerror=/i, /onclick=/i, /<iframe/i]

const isFilled = (v) => typeof v === 'string' && v.trim() !== ''

function findDangerous(text) {
  return DANGEROUS_PATTERNS.find((p) => p.test(text))
}

// 입력값을 검증하고, 통과 시 정규화된 아티클 객체를 반환합니다.
// 반환: { errors: [...], warnings: [...], article: {...} | null }
export function validateArticle(input, { today } = {}) {
  const errors = []
  const warnings = []

  // ---------- 형태 검사: 아티클 객체 1개만 허용 ----------
  if (Array.isArray(input)) {
    errors.push('아티클 객체 1개가 필요합니다. 배열 형식은 이번 버전에서 지원하지 않습니다.')
    return { errors, warnings, article: null }
  }
  if (input === null || typeof input !== 'object') {
    errors.push('아티클 JSON은 객체({ ... }) 형식이어야 합니다.')
    return { errors, warnings, article: null }
  }
  if (Array.isArray(input.articles)) {
    errors.push('아티클 객체 1개가 필요합니다. {"articles": [...]} 형식은 이번 버전에서 지원하지 않습니다.')
    return { errors, warnings, article: null }
  }

  // ---------- slug ----------
  let slug = null
  if (!isFilled(input.slug)) {
    errors.push('slug가 없습니다. (예: "male-health-guide")')
  } else {
    slug = input.slug.trim()
    if (slug !== slug.toLowerCase()) {
      errors.push(`slug "${slug}"에 대문자를 사용할 수 없습니다. 소문자로 작성해 주세요.`)
    } else if (!SLUG_PATTERN.test(slug)) {
      errors.push(
        `slug "${slug}" 형식이 잘못되었습니다. 영문 소문자·숫자·하이픈만 사용하고, ` +
          '하이픈으로 시작·끝나거나 연속 하이픈·공백·슬래시는 사용할 수 없습니다.'
      )
    }
  }

  // ---------- title ----------
  let title = null
  if (typeof input.title !== 'string' && input.title !== undefined) {
    errors.push(`title은 문자열이어야 합니다. (현재 타입: ${Array.isArray(input.title) ? 'array' : typeof input.title})`)
  } else if (!isFilled(input.title)) {
    errors.push('title이 없습니다.')
  } else {
    title = input.title.trim()
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
      warnings.push(`title 길이 ${title.length}자 — 권장 ${TITLE_MIN}~${TITLE_MAX}자`)
    }
  }

  // ---------- summary (meta description으로 사용됨) ----------
  let summary = null
  if (typeof input.summary !== 'string' && input.summary !== undefined) {
    errors.push('summary는 문자열이어야 합니다.')
  } else if (!isFilled(input.summary)) {
    errors.push('summary(요약 설명)가 없습니다. 상세 페이지의 meta description으로 사용됩니다.')
  } else {
    summary = input.summary.trim()
    if (summary.length < DESC_MIN || summary.length > DESC_MAX) {
      warnings.push(`summary 길이 ${summary.length}자 — 권장 ${DESC_MIN}~${DESC_MAX}자`)
    }
  }

  // ---------- content (기존 구조: 문단 문자열 배열) ----------
  let content = null
  if (input.content === undefined) {
    errors.push('content(본문)가 없습니다. 문단 문자열 배열로 작성해 주세요.')
  } else if (!Array.isArray(input.content)) {
    errors.push(
      `content는 문단 문자열의 배열이어야 합니다. (현재 타입: ${typeof input.content}) ` +
        '예: "content": ["첫 문단", "둘째 문단"]'
    )
  } else if (input.content.some((p) => typeof p !== 'string')) {
    errors.push('content 배열에는 문자열(문단)만 넣을 수 있습니다.')
  } else {
    content = input.content.map((p) => p.trim()).filter((p) => p !== '')
    if (content.length === 0) {
      errors.push('content(본문)가 비어 있습니다. 최소 1개 문단이 필요합니다.')
      content = null
    } else if (content.length < input.content.length) {
      warnings.push(`빈 문단 ${input.content.length - content.length}개를 제거했습니다.`)
    }
  }

  // ---------- date (선택 — 없으면 오늘 날짜 자동 입력) ----------
  let date = null
  if (input.date === undefined || (typeof input.date === 'string' && input.date.trim() === '')) {
    date = today ?? localToday()
    warnings.push(`작성일(date)이 없어 오늘 날짜(${date})를 자동 입력했습니다.`)
  } else if (typeof input.date !== 'string' || !DATE_PATTERN.test(input.date.trim())) {
    errors.push(`date는 YYYY-MM-DD 형식이어야 합니다. (입력값: ${JSON.stringify(input.date)})`)
  } else {
    date = input.date.trim()
  }

  // ---------- 위험한 콘텐츠 검사 ----------
  const textFields = [title, summary, ...(content ?? [])].filter(Boolean)
  for (const text of textFields) {
    const hit = findDangerous(text)
    if (hit) {
      errors.push(`위험한 HTML/스크립트 패턴(${hit})이 포함되어 있습니다. 본문은 일반 텍스트로만 작성해 주세요.`)
      break
    }
  }

  // ---------- 알 수 없는 키 안내 ----------
  const unknownKeys = Object.keys(input).filter((k) => !KNOWN_KEYS.includes(k))
  if (unknownKeys.length > 0) {
    warnings.push(`지원하지 않는 항목을 무시했습니다: ${unknownKeys.join(', ')} (사용 가능: ${KNOWN_KEYS.join(', ')})`)
  }

  if (errors.length > 0) return { errors, warnings, article: null }

  return { errors, warnings, article: { slug, title, summary, date, content } }
}

// 로컬 기준 오늘 날짜 (YYYY-MM-DD)
function localToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
