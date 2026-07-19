// ============================================================
// AI 호출 계층 (Anthropic Claude Messages API)
//
// - Node 내장 fetch만 사용 (외부 SDK 설치 없음)
// - API 키는 환경변수 ANTHROPIC_API_KEY 로만 주입 (저장소에 절대 저장 금지)
// - 모델은 AI_WRITER_MODEL 환경변수로 변경 가능 (기본: claude-sonnet-5)
// - 테스트를 위해 ANTHROPIC_API_URL 로 호출 주소를 바꿀 수 있음
//
// 이 파일은 "호출"만 담당합니다. 프롬프트 내용은 prompt-builder,
// 결과 검증은 article-validator, 등록은 article-importer가 담당합니다.
// ============================================================

const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const DEFAULT_MODEL = process.env.AI_WRITER_MODEL || 'claude-sonnet-5'
const TIMEOUT_MS = 180_000 // 3분
const MAX_OUTPUT_TOKENS = 8192

// API 키가 설정되어 있는지 확인 (키 자체는 밖으로 노출하지 않음)
export function hasApiKey() {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.trim() !== ''
}

export function currentModel() {
  return DEFAULT_MODEL
}

// 프롬프트를 보내고 AI의 텍스트 응답을 반환합니다.
// 네트워크 오류는 1회 자동 재시도합니다. 실패 시 한국어 메시지의 Error를 던집니다.
export async function generateText(prompt) {
  if (!hasApiKey()) {
    throw new Error(
      'ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다. ' +
        '키 없이 사용하려면 기존 수동 방식(draft-article → import-ai)을 이용해 주세요.'
    )
  }

  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await callOnce(prompt)
    } catch (e) {
      lastError = e
      // 인증·요청 오류는 재시도해도 소용없으므로 즉시 중단
      if (e.noRetry) throw e
      if (attempt === 1) console.log('  네트워크 오류가 발생해 다시 시도합니다...')
    }
  }
  throw lastError
}

async function callOnce(prompt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`AI 응답이 ${TIMEOUT_MS / 1000}초 안에 오지 않아 중단했습니다.`)
    }
    throw new Error(`AI 서버에 연결하지 못했습니다: ${e.message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.message ?? ''
    } catch {
      // 본문 파싱 실패는 무시
    }
    const err = new Error(`AI API 오류 (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
    // 4xx는 재시도 무의미 (잘못된 키, 요청 형식 등)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) err.noRetry = true
    throw err
  }

  const data = await response.json()
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  if (text.trim() === '') {
    throw new Error('AI 응답이 비어 있습니다.')
  }
  return text
}
