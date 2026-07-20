// GET /api/debug/ai — Claude API 연결 진단용 임시 엔드포인트
//
// ⚠ 문제 해결 후 이 파일은 삭제해도 됩니다.
// - 로그인한 관리자만 접근 가능 (미로그인 401)
// - 실제 서버(Cloudflare)에서 Anthropic API로 최소 요청(max_tokens: 1)을 보내고
//   응답의 status / 헤더 전체 / Body 원문을 그대로 반환합니다.
// - API Key "값"은 절대 반환·기록하지 않습니다. (존재 여부/길이/형식만 반환)

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../_lib/auth.js'
import { DEFAULT_API_URL, API_VERSION, resolveModel } from '../../_lib/ai-writer.js'

const TIMEOUT_MS = 20_000
const MAX_BODY_CHARS = 4000

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }

  const raw = context.env?.ANTHROPIC_API_KEY
  // 키 값은 노출하지 않고, 설정 실수(공백·형식)를 판별할 수 있는 정보만 제공
  const keyInfo = {
    present: typeof raw === 'string' && raw.trim() !== '',
    length: typeof raw === 'string' ? raw.length : 0,
    trimmedLength: typeof raw === 'string' ? raw.trim().length : 0,
    startsWithSkAnt: typeof raw === 'string' && raw.trim().startsWith('sk-ant-'),
    hasLeadingOrTrailingWhitespace: typeof raw === 'string' && raw !== raw.trim(),
  }

  const url = context.env?.ANTHROPIC_API_URL || DEFAULT_API_URL
  const model = resolveModel(context.env)

  if (!keyInfo.present) {
    return jsonResponse({ ok: false, keyInfo, request: { url, model }, error: 'ANTHROPIC_API_KEY가 설정되어 있지 않습니다.' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': raw.trim(),
        'anthropic-version': API_VERSION,
        'user-agent': 'aiseolab-ai-writer/1.0 (Cloudflare Pages Functions)',
      },
      // 최소 비용 요청 (성공 시 출력 토큰 1개)
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    })
  } catch (e) {
    clearTimeout(timer)
    return jsonResponse({
      ok: false,
      keyInfo,
      request: { url, model, apiVersion: API_VERSION },
      error: e?.name === 'AbortError' ? '20초 안에 응답이 오지 않았습니다.' : '연결 실패 (fetch 오류)',
    })
  }
  clearTimeout(timer)

  const bodyText = await response.text().catch(() => '(본문 읽기 실패)')
  const headers = {}
  for (const [name, value] of response.headers.entries()) headers[name] = value

  const result = {
    ok: true,
    keyInfo,
    request: { url, model, apiVersion: API_VERSION },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: bodyText.slice(0, MAX_BODY_CHARS),
    },
  }
  console.log(`[AI 진단] status=${response.status} url=${url} model=${model} bodyHead=${bodyText.slice(0, 200)}`)
  return jsonResponse(result)
}

export function onRequest() {
  return methodNotAllowed()
}
