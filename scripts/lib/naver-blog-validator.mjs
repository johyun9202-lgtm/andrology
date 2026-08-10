// ============================================================
// 네이버 블로그 원고 입력 검증
//
// article-validator.mjs(사이트 아티클용)와 목적이 다릅니다.
// 이 검증은 buildNaverBlogPrompt가 요청한 구조:
//   { title, hook, paragraphs: string[], photoGuide: string[], hashtags: string[] }
// 가 실제로 지켜졌는지만 확인합니다. 이 결과는 GitHub에 커밋되지 않고
// D1 jobs.result에만 저장되어, 대시보드에서 "복사"용으로만 쓰입니다.
// ============================================================

const TITLE_MIN = 10, TITLE_MAX = 60
const HOOK_MIN = 20, HOOK_MAX = 160
const HASHTAG_MIN = 5, HASHTAG_MAX = 20

const DANGEROUS_PATTERNS = [/<script/i, /javascript:/i, /onerror=/i, /onclick=/i, /<iframe/i, /<[a-z][\s\S]*>/i]

const isFilled = (v) => typeof v === 'string' && v.trim() !== ''

function findDangerous(text) {
  return DANGEROUS_PATTERNS.find((p) => p.test(text))
}

// 문자열 배열 정규화 (article-validator.mjs와 동일한 규칙)
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

// 입력값을 검증하고, 통과 시 정규화된 원고 객체를 반환합니다.
// 반환: { errors: [...], warnings: [...], draft: {...} | null }
export function validateNaverBlogDraft(input) {
  const errors = []
  const warnings = []

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('네이버 블로그 원고 JSON은 객체({ ... }) 형식이어야 합니다.')
    return { errors, warnings, draft: null }
  }

  // ---------- title ----------
  let title = null
  if (!isFilled(input.title)) {
    errors.push('title이 없습니다.')
  } else {
    title = input.title.trim()
    if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
      warnings.push(`title 길이 ${title.length}자 — 권장 ${TITLE_MIN}~${TITLE_MAX}자`)
    }
  }

  // ---------- hook ----------
  let hook = null
  if (!isFilled(input.hook)) {
    errors.push('hook(도입부)이 없습니다.')
  } else {
    hook = input.hook.trim()
    if (hook.length < HOOK_MIN || hook.length > HOOK_MAX) {
      warnings.push(`hook 길이 ${hook.length}자 — 권장 ${HOOK_MIN}~${HOOK_MAX}자`)
    }
  }

  // ---------- paragraphs (본문, 필수) ----------
  let paragraphs = null
  if (input.paragraphs === undefined) {
    errors.push('paragraphs(본문 문단 배열)가 없습니다.')
  } else {
    paragraphs = normalizeStringArray(input.paragraphs, 'paragraphs(본문)', errors, warnings)
    if (paragraphs && paragraphs.length === 0) {
      errors.push('paragraphs(본문)가 비어 있습니다.')
      paragraphs = null
    }
  }

  // ---------- photoGuide (선택) ----------
  let photoGuide = null
  if (input.photoGuide !== undefined) {
    photoGuide = normalizeStringArray(input.photoGuide, 'photoGuide', errors, warnings)
    if (photoGuide && photoGuide.length === 0) photoGuide = null
  }

  // ---------- hashtags (필수) ----------
  let hashtags = null
  if (input.hashtags === undefined) {
    errors.push('hashtags가 없습니다.')
  } else {
    hashtags = normalizeStringArray(input.hashtags, 'hashtags', errors, warnings)
    if (hashtags) {
      // "#" 접두사가 섞여 오는 경우가 있어 제거만 하고 오류로는 취급하지 않음
      hashtags = hashtags.map((h) => h.replace(/^#+/, '').trim()).filter((h) => h !== '')
      hashtags = [...new Set(hashtags)]
      if (hashtags.length < HASHTAG_MIN || hashtags.length > HASHTAG_MAX) {
        warnings.push(`hashtags 개수 ${hashtags.length}개 — 권장 ${HASHTAG_MIN}~${HASHTAG_MAX}개`)
      }
      if (hashtags.length === 0) {
        errors.push('hashtags가 비어 있습니다.')
        hashtags = null
      }
    }
  }

  // ---------- 위험한 콘텐츠 검사 ----------
  const textFields = [title, hook, ...(paragraphs ?? []), ...(photoGuide ?? [])].filter(Boolean)
  for (const text of textFields) {
    const hit = findDangerous(text)
    if (hit) {
      errors.push(`위험한 HTML/스크립트 패턴(${hit})이 포함되어 있습니다. 본문은 일반 텍스트로만 작성해 주세요.`)
      break
    }
  }

  if (errors.length > 0) return { errors, warnings, draft: null }

  const draft = { title, hook, paragraphs, hashtags }
  if (photoGuide && photoGuide.length > 0) draft.photoGuide = photoGuide

  return { errors, warnings, draft }
}
