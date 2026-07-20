// /api/jobs — Job 생성(POST) 및 최근 목록 조회(GET)
//
// - 두 요청 모두 로그인 세션 필수 (서버에서 재검증)
// - Job은 Cloudflare D1(바인딩 이름: DB)에 영구 저장됩니다
// - Claude API 호출·Article 생성은 다음 단계에서 이 파일에 연결됩니다

import {
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
  isAuthenticated,
  ALLOWED_SITES,
} from '../_lib/auth.js'
import { insertJob, listJobs } from '../_lib/job-repository.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'

const MAX_KEYWORD_LENGTH = 200
const MAX_TITLE_LENGTH = 200

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

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

  try {
    const job = await insertJob(db, {
      id: `job_${crypto.randomUUID()}`,
      type: 'article_draft',
      site,
      keyword,
      title,
    })
    return jsonResponse({ ok: true, job })
  } catch {
    return jsonResponse({ ok: false, error: '작업 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  try {
    const jobs = await listJobs(db)
    return jsonResponse({ ok: true, jobs })
  } catch {
    return jsonResponse({ ok: false, error: '작업 목록을 불러오지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
