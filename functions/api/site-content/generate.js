// POST /api/site-content/generate — AI 홈페이지 초안 생성 (Phase 12)
//
// 업종·기본 사업 정보를 입력받아 Claude API로 홈페이지 문구·SEO 초안을 생성합니다.
// **이 API는 아무것도 저장하지 않습니다.** 생성 결과는 사용자가 대시보드에서
// 검토·수정한 뒤 "적용" 버튼으로 기존 site-settings API(merge 저장)를 통해 저장됩니다.
//
// 보안:
// - 관리자 인증 필수, site allowlist·template 존재 확인
// - 입력 길이 제한·URL 검증·제어문자 제거, 입력은 프롬프트에서 데이터 블록으로 격리
// - 응답은 화이트리스트 정제(허용 필드·길이 제한만 통과) 후 반환
// - API 키·Gateway URL·프롬프트 원문은 응답에 포함되지 않음

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { TEMPLATES } from '../../_lib/site-data.generated.js'
import { callClaude, resolveModel, safeErrorMessage } from '../../_lib/ai-writer.js'
import {
  buildSiteContentPrompt,
  sanitizeDraft,
  checkForbiddenPhrases,
  INPUT_LIMITS,
} from '../../_lib/site-content-prompt.js'
import { isValidHttpUrl } from '../../../src/lib/schema.js'

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (v) => String(v ?? '').replace(CONTROL_CHARS, '').trim()

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, 20_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  const site = typeof body.site === 'string' ? body.site : ''
  if (!ALLOWED_SITES.includes(site)) {
    return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)
  }
  const template = TEMPLATES[typeof body.template === 'string' ? body.template : '']
  if (!template) {
    return jsonResponse({ ok: false, error: `등록되지 않은 템플릿입니다. 사용 가능: ${Object.keys(TEMPLATES).join(', ')}` }, 400)
  }

  // ---------- 입력 검증 ----------
  const raw = body.input && typeof body.input === 'object' ? body.input : {}
  const input = {}
  for (const [key, max] of Object.entries(INPUT_LIMITS)) {
    if (key === 'services') continue
    const value = clean(raw[key])
    if (value.length > max) {
      return jsonResponse({ ok: false, error: `${key} 항목은 ${max}자 이내여야 합니다.` }, 400)
    }
    input[key] = value
  }
  if (input.name === '') {
    return jsonResponse({ ok: false, error: '업체명을 입력해 주세요.' }, 400)
  }
  // services: 배열 또는 콤마 구분 문자열 (최대 10개)
  const servicesRaw = Array.isArray(raw.services) ? raw.services : String(raw.services ?? '').split(',')
  input.services = servicesRaw.map((s) => clean(s)).filter((s) => s !== '').slice(0, 10)
  if (input.services.some((s) => s.length > INPUT_LIMITS.services)) {
    return jsonResponse({ ok: false, error: `서비스 항목은 각 ${INPUT_LIMITS.services}자 이내여야 합니다.` }, 400)
  }
  // 상담/예약 URL — http/https만 (프롬프트에는 넣지 않고, 적용 단계에서 사용)
  const consultationUrl = clean(raw.consultationUrl)
  if (consultationUrl !== '' && !isValidHttpUrl(consultationUrl)) {
    return jsonResponse({ ok: false, error: '상담/예약 URL은 http:// 또는 https:// 주소여야 합니다.' }, 400)
  }

  // ---------- AI 생성 (기존 AI Writer 헬퍼 재사용 — AI Gateway·타임아웃 포함) ----------
  const model = resolveModel(context.env)
  try {
    const prompt = buildSiteContentPrompt(template, input)
    const text = await callClaude(context.env, prompt, model)

    // 파싱: 코드펜스·앞뒤 잡음 대응 (AI Writer와 동일 방식)
    let cleaned = String(text).trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim()
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first === -1 || last === -1 || last <= first) {
      return jsonResponse({ ok: false, error: 'AI 응답이 JSON 형식이 아닙니다. 다시 생성해 주세요.' }, 502)
    }
    let parsed
    try {
      parsed = JSON.parse(cleaned.slice(first, last + 1))
    } catch {
      return jsonResponse({ ok: false, error: 'AI 응답 JSON을 해석하지 못했습니다. 다시 생성해 주세요.' }, 502)
    }

    // 화이트리스트 정제 + 금지 표현 스캔
    const { draft, warnings } = sanitizeDraft(parsed)
    warnings.push(...checkForbiddenPhrases(template.id, draft))
    if (draft.hero.title === '' && draft.about.description === '') {
      return jsonResponse({ ok: false, error: 'AI가 유효한 초안을 생성하지 못했습니다. 입력을 보완해 다시 시도해 주세요.' }, 502)
    }

    return jsonResponse({ ok: true, draft, warnings, model })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[AI 초안 생성 실패] site=${site} template=${template.id} message=${message}`)
    return jsonResponse({ ok: false, error: message }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
