// GET /api/published-articles — 게시된 글 목록 (D1 게시 이력 기준)
//
// - 관리자 인증 필수, 최신순, 페이지네이션(기본 20개)
// - 필터: site / status(published|deleted) / deployment(pending|deployed|deploy_failed) / q(검색)
// - Token·내부 오류는 응답에 포함되지 않음

import { jsonResponse, methodNotAllowed, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { listPublishedJobs, DEPLOYMENT_STATUSES } from '../_lib/job-repository.js'

const MAX_SEARCH_LENGTH = 100

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  const params = new URL(context.request.url).searchParams

  const site = params.get('site') ?? ''
  if (site !== '' && !ALLOWED_SITES.includes(site)) {
    return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)
  }
  const status = params.get('status') ?? ''
  if (status !== '' && status !== 'published' && status !== 'deleted') {
    return jsonResponse({ ok: false, error: 'status는 published 또는 deleted만 가능합니다.' }, 400)
  }
  const deployment = params.get('deployment') ?? ''
  if (deployment !== '' && !DEPLOYMENT_STATUSES.includes(deployment)) {
    return jsonResponse({ ok: false, error: '올바르지 않은 deployment 값입니다.' }, 400)
  }
  const search = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH)
  const page = Math.max(1, Number(params.get('page')) || 1)

  try {
    const { jobs, total, pageSize } = await listPublishedJobs(db, {
      site: site || undefined,
      publishStatus: status || undefined,
      deploymentStatus: deployment || undefined,
      search: search || undefined,
      page,
    })
    return jsonResponse({
      ok: true,
      articles: jobs,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch {
    return jsonResponse({ ok: false, error: '게시 글 목록을 불러오지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
