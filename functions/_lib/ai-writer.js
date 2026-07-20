// ============================================================
// AI Writer (Cloudflare Pages Functions용)
//
// Job(키워드·사이트)을 입력으로 Claude API를 호출해
// Article Model v2 형식의 아티클 JSON을 생성합니다.
//
// 재사용:
// - 프롬프트 규칙: scripts/lib/prompt-builder.mjs (CLI와 동일한 단일 원천)
// - 결과 구조 검증: scripts/lib/article-validator.mjs
// - 사이트 정보: sites/<siteId>/hospital.json (빌드 시점에 번들로 포함)
//
// 주의:
// - API 키는 context.env.ANTHROPIC_API_KEY (Cloudflare Secret)로만 주입.
//   키 값은 로그·응답·오류 메시지에 절대 포함하지 않습니다.
// - scripts/lib/ai-client.mjs는 Node의 process.env에 의존하므로 여기서는
//   재사용하지 않고, Workers env 기반의 호출부를 이 파일에 별도로 둡니다.
//   (프롬프트·검증 로직은 공유하므로 규칙 중복은 없습니다)
// ============================================================

import { buildArticlePrompt, sanitize } from '../../scripts/lib/prompt-builder.mjs'
import { validateArticle } from '../../scripts/lib/article-validator.mjs'
// 사이트 정보 (functions는 배포 후 파일시스템에 접근할 수 없어 빌드 시점에 포함)
// npm run build 가 sites/<siteId>/hospital.json에서 자동 생성하는 일반 JS 모듈입니다.
// (JSON 직접 import는 번들러 버전에 따라 배포가 실패할 수 있어 사용하지 않습니다)
import { SITE_DATA } from './site-data.generated.js'

// 모델명은 이 상수 한 곳에서만 관리합니다.
// 배포 환경에서 코드 수정 없이 바꾸려면 env(AI_WRITER_MODEL)로 재정의하세요.
export const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const TIMEOUT_MS = 90_000 // Cloudflare 단일 요청 안에서 처리해야 하므로 CLI(180초)보다 짧게
const MAX_OUTPUT_TOKENS = 8192
const MAX_ERROR_LENGTH = 500

export function resolveModel(env) {
  const custom = typeof env?.AI_WRITER_MODEL === 'string' ? env.AI_WRITER_MODEL.trim() : ''
  return custom || DEFAULT_MODEL
}

// Job id(job_<uuid>)에서 결정적인 임시 slug 생성: draft-xxxxxxxx
// 실제 발행(Article 등록) 시 사람이 검토하며 SEO에 맞는 slug로 바꾸는 것을 전제로 합니다.
export function jobSlug(jobId) {
  const hex = String(jobId).replace(/^job_/, '').replace(/[^0-9a-f]/g, '').slice(0, 8)
  return `draft-${hex || 'article'}`
}

// Job → 프롬프트 (기존 prompt-builder 재사용, 키워드·제목은 sanitize로 무해화)
export function buildJobPrompt(job) {
  const hospital = SITE_DATA[job.site]
  if (!hospital) {
    throw new Error(`사이트 정보를 찾을 수 없습니다: ${sanitize(String(job.site))}`)
  }
  const slug = jobSlug(job.id)
  const keyword = sanitize(String(job.keyword ?? ''))
  const title = sanitize(String(job.title ?? ''))
  const brief = {
    slug,
    mainKeyword: keyword,
    subKeywords: '',
    searchIntent: `"${keyword}"를 검색한 사용자의 의도를 추정해 작성 (정보 탐색 목적 우선)`,
    audience: '해당 주제를 처음 검색해 보는 일반 사용자',
    purpose: '검색 사용자의 질문에 정확하게 답해 사이트 신뢰도를 높이는 정보성 글',
    targetLength: '공백 포함 1,500~2,500자 (Cloudflare 응답 시간 제한 고려)',
    extraNotes: title
      ? `제목은 가능하면 "${title}"을(를) 자연스럽게 다듬어 사용하세요.`
      : '',
  }
  return { prompt: buildArticlePrompt(hospital, brief), slug }
}

// Claude Messages API 호출 (fetch 기반, 타임아웃 포함)
// 실패 시 사용자에게 보여줘도 안전한 한국어 메시지의 Error를 던집니다.
export async function callClaude(env, prompt, model) {
  const apiKey = typeof env?.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : ''
  if (apiKey === '') {
    throw new Error(
      'ANTHROPIC_API_KEY Secret이 설정되지 않았습니다. Cloudflare Pages → Settings → Variables and Secrets에서 추가한 뒤 재배포해 주세요.'
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch(env.ANTHROPIC_API_URL || DEFAULT_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`AI 응답이 ${TIMEOUT_MS / 1000}초 안에 오지 않아 중단했습니다. 잠시 후 "다시 실행"해 주세요.`)
    }
    throw new Error('AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      if (typeof body?.error?.message === 'string') {
        // 외부 API의 오류 문구는 제어문자 제거 후 길이 제한해서만 전달
        detail = sanitize(body.error.message).slice(0, 200)
      }
    } catch {
      // 오류 본문 파싱 실패는 무시 (상태 코드만 전달)
    }
    throw new Error(`AI API 오류 (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  }

  const data = await response.json().catch(() => null)
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('')

  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('AI 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.')
  }
  return text
}

// AI 응답 텍스트 → 검증된 아티클 객체
// (코드펜스 제거 → JSON 파싱 → Article Model v2 구조 검증 → slug 고정)
export function parseGeneratedArticle(text, expectedSlug) {
  let cleaned = String(text).trim()
  // 지시를 어기고 ```json ... ``` 으로 감싼 경우 대비
  cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim()
  // 앞뒤에 설명 문장이 붙은 경우 대비: 첫 { 부터 마지막 } 까지만 사용
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('AI 응답이 JSON 형식이 아닙니다. "다시 실행"으로 재시도해 주세요.')
  }
  cleaned = cleaned.slice(first, last + 1)

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI 응답 JSON을 해석하지 못했습니다. "다시 실행"으로 재시도해 주세요.')
  }

  const { errors, article } = validateArticle(parsed)
  if (errors.length > 0 || !article) {
    const summary = errors.slice(0, 2).map((m) => sanitize(String(m))).join(' / ')
    throw new Error(`AI 결과가 아티클 형식 검증에 실패했습니다. (${summary || '구조 오류'})`)
  }

  // slug는 서버가 정한 값으로 강제 (AI가 임의 slug를 만들지 못하게)
  article.slug = expectedSlug
  return article
}

// D1의 result 컬럼에 저장할 구조화 JSON (문자열 반환)
export function buildResultPayload(job, article, model) {
  return JSON.stringify({
    title: article.title,
    slug: article.slug,
    metaDescription: article.summary, // Article Model v2의 summary가 메타 설명 역할
    excerpt: article.intro ?? '',
    keyword: job.keyword,
    generatedAt: new Date().toISOString(),
    model,
    article, // 본문(sections)·FAQ 포함 전체 — 이후 Article 등록 단계에서 그대로 사용
  })
}

// 오류 → 저장·표시해도 안전한 문자열 (스택·키 값 미포함, 길이 제한)
export function safeErrorMessage(e) {
  const message = e instanceof Error && typeof e.message === 'string' ? e.message : ''
  const cleanedMessage = sanitize(message).slice(0, MAX_ERROR_LENGTH)
  return cleanedMessage || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
}
