// POST /api/jobs — AI 초안 생성 Job 접수 (v1 골격)
//
// 이번 버전은 Job을 저장하지 않고 요청 검증 후 Job 객체만 반환합니다.
// (영구 저장은 다음 단계에서 D1 연결 시 이 파일에 추가됩니다.
//  Claude API 호출도 이 파일이 연결 지점이 됩니다.)

import {
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  isAuthenticated,
  ALLOWED_SITES,
} from '../_lib/auth.js'

const MAX_KEYWORD_LENGTH = 200
const MAX_TITLE_LENGTH = 200

export async function onRequestPost(context) {
  // 화면을 우회해 직접 호출해도 서버에서 세션을 재검증합니다
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }

  const body = await readJsonBody(context.request, 10_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : ''
  if (keyword === '') {
    return jsonResponse({ ok: false, error: '키워드를 입력해 주세요.' }, 400)
  }
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return jsonResponse({ ok: false, error: `키워드는 ${MAX_KEYWORD_LENGTH}자 이내여야 합니다.` }, 400)
  }

  let title = ''
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string' || body.title.length > MAX_TITLE_LENGTH) {
      return jsonResponse({ ok: false, error: `제목은 ${MAX_TITLE_LENGTH}자 이내의 문자열이어야 합니다.` }, 400)
    }
    title = body.title.trim()
  }

  const site = typeof body.site === 'string' ? body.site.trim() : ''
  if (!ALLOWED_SITES.includes(site)) {
    return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)
  }

  const job = {
    id: `job_${crypto.randomUUID()}`,
    type: 'article_draft',
    keyword,
    title,
    site,
    status: 'queued',
    createdAt: new Date().toISOString(),
  }

  return jsonResponse({ ok: true, job })
}

export function onRequest() {
  return methodNotAllowed()
}
