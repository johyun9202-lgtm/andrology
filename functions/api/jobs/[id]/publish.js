// POST /api/jobs/:id/publish — 검토 완료된 completed Job을 실제 사이트에 게시
//
// 흐름: 인증 → Job 조회 → completed·게시 상태 검증 → 결과 재검증(Article Model v2)
//       → 게시 선점(draft/publish_failed → publishing, 원자적)
//       → GitHub Contents API로 hospital.json에 아티클 추가 커밋
//       → 성공: published (경로·URL·커밋 SHA 저장) / 실패: publish_failed
//
// 중복 게시 방지는 프론트가 아니라 서버(claimJobForPublish의 조건부 UPDATE)가
// 보장합니다. published/publishing 상태에서는 다시 게시되지 않습니다.
// (publishing으로 15분 이상 방치된 경우에만 재시도 허용 — 요청 중단 복구)

import { jsonResponse, methodNotAllowed, isAuthenticated, ALLOWED_SITES } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import {
  getJob,
  claimJobForPublish,
  markJobPublished,
  markJobPublishFailed,
} from '../../../_lib/job-repository.js'
import { resolveGitHubConfig, publishArticle } from '../../../_lib/publisher.js'
import { safeErrorMessage } from '../../../_lib/ai-writer.js'

const JOB_ID_PATTERN = /^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  const id = typeof context.params?.id === 'string' ? context.params.id : ''
  if (!JOB_ID_PATTERN.test(id)) {
    return jsonResponse({ ok: false, error: '올바르지 않은 작업 ID입니다.' }, 400)
  }

  let job
  try {
    job = await getJob(db, id)
  } catch {
    return jsonResponse({ ok: false, error: '작업을 불러오지 못했습니다.' }, 500)
  }
  if (!job) return jsonResponse({ ok: false, error: '작업을 찾을 수 없습니다.' }, 404)

  // AI 생성이 완료된 작업만 게시 가능
  if (job.status !== 'completed') {
    return jsonResponse({ ok: false, error: 'AI 생성이 완료된 작업만 게시할 수 있습니다.' }, 409)
  }
  if (job.publishStatus === 'published') {
    return jsonResponse({ ok: false, error: '이미 게시된 작업입니다.' }, 409)
  }
  if (!ALLOWED_SITES.includes(job.site)) {
    return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)
  }

  // 게시할 결과 재검증 (Article Model v2) — 선점 전에 걸러 publishing 잔류 방지
  let article
  try {
    const payload = JSON.parse(job.result)
    article = payload?.article
  } catch {
    article = null
  }
  if (!article || typeof article !== 'object') {
    return jsonResponse({ ok: false, error: '게시할 생성 결과가 없거나 형식이 올바르지 않습니다.' }, 422)
  }

  // GitHub 설정 확인 — 선점 전에 확인해 미설정 시 publishing 상태를 만들지 않음
  const config = resolveGitHubConfig(context.env)
  if (!config.ok) {
    return jsonResponse({ ok: false, error: config.error }, 500)
  }

  // 게시 선점: 상태 검사 + publishing 전환을 한 번의 조건부 UPDATE로 (동시 요청 방어)
  let claimed
  try {
    claimed = await claimJobForPublish(db, id)
  } catch {
    return jsonResponse({ ok: false, error: '게시 상태를 변경하지 못했습니다.' }, 500)
  }
  if (!claimed) {
    return jsonResponse({ ok: false, error: '이미 게시 중이거나 게시된 작업입니다.' }, 409)
  }

  try {
    const result = await publishArticle(config, job, article)
    const updated = await markJobPublished(db, id, result)
    return jsonResponse({ ok: true, job: updated })
  } catch (e) {
    const message = safeErrorMessage(e)
    // 운영 로그: 토큰·응답 원문 없이 원인 파악용 최소 정보만
    console.error(`[게시 실패] job=${id} site=${job.site} message=${message}`)
    const updated = await markJobPublishFailed(db, id, message).catch(() => null)
    return jsonResponse({ ok: false, error: message, job: updated }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
