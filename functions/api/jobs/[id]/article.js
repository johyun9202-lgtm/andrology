// /api/jobs/:id/article — 게시 글 조회(GET) / 수정(PUT) / 삭제(DELETE)
//
// - 모두 관리자 인증 필수
// - 개별 아티클 파일(sites/<site>/articles/<slug>.json)로 게시된 글만 대상
//   (레거시 hospital.json 배열 글은 관리 대상 아님 — publisher가 경로 형식으로 차단)
// - slug·경로는 D1의 검증된 published_path만 사용 (사용자 입력이 경로에 못 들어감)
// - 수정: 현재 파일 sha 기반 PUT (그 사이 변경되면 409/422 충돌), 동일 내용이면 커밋 생략
// - 삭제: sha 기반 DELETE — 커밋 이력이 남아 복구 가능, D1 Job은 감사 이력으로 유지

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getJob, markArticleUpdated, markArticleDeleted } from '../../../_lib/job-repository.js'
import {
  resolveGitHubConfig,
  updatePublishedArticle,
  deletePublishedArticle,
  parseArticlePath,
} from '../../../_lib/publisher.js'
import { safeErrorMessage } from '../../../_lib/ai-writer.js'

const JOB_ID_PATTERN = /^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_BODY_BYTES = 200_000

// 공통 준비: 인증 → DB → Job 조회. 실패 시 { response } 반환.
async function prepare(context, { requirePublished = true } = {}) {
  if (!(await isAuthenticated(context))) {
    return { response: jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401) }
  }
  const db = getDb(context)
  if (!db) return { response: dbUnavailableResponse(context) }

  const id = typeof context.params?.id === 'string' ? context.params.id : ''
  if (!JOB_ID_PATTERN.test(id)) {
    return { response: jsonResponse({ ok: false, error: '올바르지 않은 작업 ID입니다.' }, 400) }
  }
  let job
  try {
    job = await getJob(db, id)
  } catch {
    return { response: jsonResponse({ ok: false, error: '작업을 불러오지 못했습니다.' }, 500) }
  }
  if (!job) return { response: jsonResponse({ ok: false, error: '작업을 찾을 수 없습니다.' }, 404) }

  if (requirePublished && job.publishStatus !== 'published') {
    const message = job.publishStatus === 'deleted' ? '이미 삭제된 글입니다.' : '게시된 글만 관리할 수 있습니다.'
    return { response: jsonResponse({ ok: false, error: message }, 409) }
  }
  if (requirePublished && !parseArticlePath(job.publishedPath)) {
    return {
      response: jsonResponse(
        { ok: false, error: '개별 아티클 파일로 게시된 글만 관리할 수 있습니다. (레거시 글은 저장소에서 직접 수정해 주세요)' },
        400
      ),
    }
  }
  return { db, job }
}

function articleFromJob(job) {
  try {
    const payload = JSON.parse(job.result)
    return payload?.article && typeof payload.article === 'object' ? payload : null
  } catch {
    return null
  }
}

// ---------- GET: 게시 글 데이터 조회 (편집 폼 채우기용) ----------
export async function onRequestGet(context) {
  const ready = await prepare(context, { requirePublished: false })
  if (ready.response) return ready.response
  const { job } = ready
  if (job.publishStatus !== 'published' && job.publishStatus !== 'deleted') {
    return jsonResponse({ ok: false, error: '게시된 글만 조회할 수 있습니다.' }, 409)
  }
  const payload = articleFromJob(job)
  if (!payload) return jsonResponse({ ok: false, error: '저장된 아티클 데이터를 읽지 못했습니다.' }, 500)
  return jsonResponse({
    ok: true,
    article: payload.article,
    publishStatus: job.publishStatus,
    publishedPath: job.publishedPath,
    publishedUrl: job.publishedUrl,
  })
}

// ---------- PUT: 게시 글 수정 ----------
export async function onRequestPut(context) {
  const ready = await prepare(context)
  if (ready.response) return ready.response
  const { db, job } = ready

  const body = await readJsonBody(context.request, MAX_BODY_BYTES)
  if (body === null || typeof body !== 'object' || !body.article || typeof body.article !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (article 객체 필요)' }, 400)
  }

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const result = await updatePublishedArticle(config, job, body.article)
    if (result.noChange) {
      return jsonResponse({ ok: false, error: '변경 사항이 없습니다. (원본과 동일한 내용)' }, 400)
    }
    // D1의 result도 수정본으로 갱신 → Dashboard 미리보기와 실제 파일 일치
    const payload = articleFromJob(job) ?? {}
    payload.article = result.article
    payload.title = result.article.title
    payload.metaDescription = result.article.summary
    const updated = await markArticleUpdated(db, job.id, { sha: result.sha, result: JSON.stringify(payload) })
    return jsonResponse({ ok: true, job: updated })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[게시 글 수정 실패] job=${job.id} site=${job.site} message=${message}`)
    const status = message.includes('충돌') || message.includes('변경되어') ? 409 : message.includes('검증') ? 422 : 500
    return jsonResponse({ ok: false, error: message }, status)
  }
}

// ---------- DELETE: 게시 글 삭제 ----------
export async function onRequestDelete(context) {
  const ready = await prepare(context)
  if (ready.response) return ready.response
  const { db, job } = ready

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const result = await deletePublishedArticle(config, job)
    const updated = await markArticleDeleted(db, job.id, { sha: result.sha })
    return jsonResponse({
      ok: true,
      job: updated,
      note: '저장소에서 삭제되었습니다. 재배포가 끝나면 실제 URL이 404가 됩니다. (커밋 이력으로 복구 가능)',
    })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[게시 글 삭제 실패] job=${job.id} site=${job.site} message=${message}`)
    return jsonResponse({ ok: false, error: message }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
