// ============================================================
// 아티클 입력 검증 (Article Model v2 지원)
//
// create-article CLI가 입력 JSON(아티클 객체 1개)의 "구조"를 검증합니다.
// - 구조·타입·필수값 문제 → 오류 (등록 중단)
// - SEO 권장 길이 문제 → 경고 (등록은 진행, 최종 판단은 전체 SEO 검사)
//
// 지원 형식 (완전 호환):
//   v1: { slug, title, summary, date?, content: string[] }
//   v2: { slug, title, summary, date?, updatedAt?, intro?,
//         content?, sections?, faq?, relatedArticles? }
//   content와 sections 중 최소 하나에는 실제 본문이 있어야 합니다.
//
// 사이트 전체 SEO 검증은 scripts/lib/seo-checker.mjs 담당이며,
// 이 파일은 입력 아티클 1개의 구조 검증만 담당합니다. (규칙 중복 없음)
// ============================================================

// 기존 정책 유지: 지원 필드 외의 키는 무시하고 경고로 안내합니다.
const KNOWN_KEYS = ['slug', 'title', 'summary', 'date', 'updatedAt', 'intro', 'content', 'sections', 'faq', 'relatedArticles']

// seo-checker와 동일한 기준
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TITLE_MIN = 15, TITLE_MAX = 60
const DESC_MIN = 50, DESC_MAX = 160
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 위험한 HTML/스크립트 패턴 (본문은 일반 텍스트 기반이므로 발견 시 오류)
const DANGEROUS_PATTERNS = [/<script/i, /javascript:/i, /onerror=/i, /onclick=/i, /<iframe/i]

const isFilled = (v) => typeof v === 'string' && v.trim() !== ''

// slug 형식 검증 — create-draft-prompt 등 다른 도구도 이 함수를 재사용합니다.
export function isValidSlug(slug) {
  return typeof slug === 'string' && slug === slug.toLowerCase() && SLUG_PATTERN.test(slug)
}

function findDangerous(text) {
  return DANGEROUS_PATTERNS.find((p) => p.test(text))
}

// 문자열 배열 정규화: 문자열 아님 → null(오류), 통과 시 trim + 빈 항목 제거
function normalizeStringArray(value, label, errors, warnings) {
  if (!Array.isArray(value)) {
    errors.push(`${label}은(는) 문자열 배열이어야 합니다. (현재 타입: ${typeof value})`)
    return null
  }
  if (value.some((v) => typeof v !== 'string')) {
    errors.push(`${label} 배열에는 문자열만 넣을 수 있습니다.`)
    return null
  }
  const cleaned = value.map((v) => v.trim()).filter((v) => v !== '')
  if (cleaned.length < value.length) {
    warnings.push(`${label}에서 빈 항목 ${value.length - cleaned.length}개를 제거했습니다.`)
  }
  return cleaned
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

  // ---------- intro (선택, v2) ----------
  let intro = null
  if (input.intro !== undefined) {
    if (typeof input.intro !== 'string') {
      errors.push('intro(도입문)는 문자열이어야 합니다.')
    } else if (input.intro.trim() !== '') {
      intro = input.intro.trim()
    }
  }

  // ---------- content (v1 본문 — 선택, 있으면 문단 문자열 배열) ----------
  let content = null
  if (input.content !== undefined) {
    content = normalizeStringArray(input.content, 'content(본문)', errors, warnings)
    if (content && content.length === 0) content = null
  }

  // ---------- sections (v2 본문 — 선택) ----------
  let sections = null
  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections)) {
      errors.push('sections는 배열이어야 합니다.')
    } else {
      sections = []
      input.sections.forEach((section, i) => {
        const where = `sections[${i}]`
        if (section === null || typeof section !== 'object' || Array.isArray(section)) {
          errors.push(`${where}은 객체여야 합니다.`)
          return
        }
        const normalized = {}
        if (section.heading !== undefined && typeof section.heading !== 'string') {
          errors.push(`${where}.heading은 문자열이어야 합니다.`)
        } else {
          normalized.heading = isFilled(section.heading) ? section.heading.trim() : ''
        }
        if (section.paragraphs !== undefined) {
          const paragraphs = normalizeStringArray(section.paragraphs, `${where}.paragraphs`, errors, warnings)
          if (paragraphs) normalized.paragraphs = paragraphs
        }
        if (section.subsections !== undefined) {
          if (!Array.isArray(section.subsections)) {
            errors.push(`${where}.subsections는 배열이어야 합니다.`)
          } else {
            normalized.subsections = []
            section.subsections.forEach((sub, j) => {
              const subWhere = `${where}.subsections[${j}]`
              if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) {
                errors.push(`${subWhere}은 객체여야 합니다.`)
                return
              }
              const subNorm = {}
              if (sub.heading !== undefined && typeof sub.heading !== 'string') {
                errors.push(`${subWhere}.heading은 문자열이어야 합니다.`)
              } else {
                subNorm.heading = isFilled(sub.heading) ? sub.heading.trim() : ''
              }
              if (sub.paragraphs !== undefined) {
                const paragraphs = normalizeStringArray(sub.paragraphs, `${subWhere}.paragraphs`, errors, warnings)
                if (paragraphs) subNorm.paragraphs = paragraphs
              }
              if (sub.items !== undefined) {
                const items = normalizeStringArray(sub.items, `${subWhere}.items`, errors, warnings)
                if (items) subNorm.items = items
              }
              normalized.subsections.push(subNorm)
            })
          }
        }
        sections.push(normalized)
      })
      if (sections.length === 0) sections = null
    }
  }

  // ---------- 본문 존재 규칙: content와 sections 중 하나에는 실제 내용 필요 ----------
  const sectionText = (sections ?? []).flatMap((s) => [
    ...(s.paragraphs ?? []),
    ...(s.subsections ?? []).flatMap((sub) => [...(sub.paragraphs ?? []), ...(sub.items ?? [])]),
  ])
  if (!((content && content.length > 0) || sectionText.length > 0)) {
    errors.push('본문이 비어 있습니다. content(문단 배열) 또는 sections에 실제 내용이 필요합니다.')
  }

  // ---------- faq (선택, v2) ----------
  let faq = null
  if (input.faq !== undefined) {
    if (!Array.isArray(input.faq)) {
      errors.push('faq는 배열이어야 합니다. 예: [{"question":"...","answer":"..."}]')
    } else {
      faq = []
      input.faq.forEach((item, i) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`faq[${i}]은 {question, answer} 객체여야 합니다.`)
          return
        }
        if (!isFilled(item.question)) errors.push(`faq[${i}]: 질문(question)이 비어 있습니다.`)
        if (!isFilled(item.answer)) errors.push(`faq[${i}]: 답변(answer)이 비어 있습니다.`)
        if (isFilled(item.question) && isFilled(item.answer)) {
          faq.push({ question: item.question.trim(), answer: item.answer.trim() })
        }
      })
      if (faq.length === 0) faq = null
    }
  }

  // ---------- relatedArticles (선택, v2) ----------
  let relatedArticles = null
  if (input.relatedArticles !== undefined) {
    const slugs = normalizeStringArray(input.relatedArticles, 'relatedArticles', errors, warnings)
    if (slugs) {
      for (const s of slugs) {
        if (!SLUG_PATTERN.test(s)) {
          errors.push(`relatedArticles의 "${s}"는 올바른 slug 형식이 아닙니다.`)
        }
      }
      relatedArticles = [...new Set(slugs)]
      if (relatedArticles.length < slugs.length) warnings.push('relatedArticles에서 중복 slug를 제거했습니다.')
      if (relatedArticles.length === 0) relatedArticles = null
    }
  }

  // ---------- date / updatedAt ----------
  let date = null
  if (input.date === undefined || (typeof input.date === 'string' && input.date.trim() === '')) {
    date = today ?? localToday()
    warnings.push(`작성일(date)이 없어 오늘 날짜(${date})를 자동 입력했습니다.`)
  } else if (typeof input.date !== 'string' || !DATE_PATTERN.test(input.date.trim())) {
    errors.push(`date는 YYYY-MM-DD 형식이어야 합니다. (입력값: ${JSON.stringify(input.date)})`)
  } else {
    date = input.date.trim()
  }

  let updatedAt = null
  if (input.updatedAt !== undefined && !(typeof input.updatedAt === 'string' && input.updatedAt.trim() === '')) {
    if (typeof input.updatedAt !== 'string' || !DATE_PATTERN.test(input.updatedAt.trim())) {
      errors.push(`updatedAt은 YYYY-MM-DD 형식이어야 합니다. (입력값: ${JSON.stringify(input.updatedAt)})`)
    } else {
      updatedAt = input.updatedAt.trim()
      if (date && updatedAt < date) {
        errors.push(`updatedAt(${updatedAt})이 작성일 date(${date})보다 이전입니다. 날짜를 확인해 주세요.`)
      }
    }
  }

  // ---------- 위험한 콘텐츠 검사 (새 필드 전체 포함) ----------
  const textFields = [
    title, summary, intro,
    ...(content ?? []),
    ...sectionText,
    ...(sections ?? []).flatMap((s) => [s.heading, ...(s.subsections ?? []).map((sub) => sub.heading)]),
    ...(faq ?? []).flatMap((f) => [f.question, f.answer]),
  ].filter(Boolean)
  for (const text of textFields) {
    const hit = findDangerous(text)
    if (hit) {
      errors.push(`위험한 HTML/스크립트 패턴(${hit})이 포함되어 있습니다. 본문은 일반 텍스트로만 작성해 주세요.`)
      break
    }
  }

  // ---------- 알 수 없는 키 안내 (기존 정책 유지: 무시 + 경고) ----------
  const unknownKeys = Object.keys(input).filter((k) => !KNOWN_KEYS.includes(k))
  if (unknownKeys.length > 0) {
    warnings.push(`지원하지 않는 항목을 무시했습니다: ${unknownKeys.join(', ')} (사용 가능: ${KNOWN_KEYS.join(', ')})`)
  }

  if (errors.length > 0) return { errors, warnings, article: null }

  // 존재하는 필드만 담아 반환 (v1 아티클에 빈 v2 필드를 추가하지 않음)
  const article = { slug, title, summary, date }
  if (updatedAt) article.updatedAt = updatedAt
  if (intro) article.intro = intro
  if (content && content.length > 0) article.content = content
  if (sections && sections.length > 0) article.sections = sections
  if (faq && faq.length > 0) article.faq = faq
  if (relatedArticles && relatedArticles.length > 0) article.relatedArticles = relatedArticles

  return { errors, warnings, article }
}

// 로컬 기준 오늘 날짜 (YYYY-MM-DD)
function localToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
