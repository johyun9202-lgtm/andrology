// POST /api/jobs/:id/run — queued/failed Job을 실제 Claude API로 실행
//
// 흐름: 인증 확인 → Job 조회 → 실행 선점(queued/failed → running, 원자적)
//       → 프롬프트 생성 → Claude 호출 → 결과 파싱·검증
//       → 성공: result 저장 + completed / 실패: error 저장 + failed
//
// 중복 실행 방지는 프론트 버튼이 아니라 서버(claimJobForRun의 조건부 UPDATE)가
// 보장합니다. running/completed 상태에서는 다시 실행되지 않습니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import {
  getJob,
  claimJobForRun,
  markJobCompleted,
  markJobFailed,
} from '../../../_lib/job-repository.js'
import {
  buildJobPrompt,
  callClaude,
  parseGeneratedArticle,
  buildResultPayload,
  resolveModel,
  safeErrorMessage,
} from '../../../_lib/ai-writer.js'

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

  if (job.status === 'running') {
    return jsonResponse({ ok: false, error: '이미 실행 중인 작업입니다.' }, 409)
  }
  if (job.status === 'completed') {
    return jsonResponse({ ok: false, error: '이미 완료된 작업입니다. 새 작업을 생성해 주세요.' }, 409)
  }

  // 상태 검사 + running 전환을 한 번의 조건부 UPDATE로 (동시 요청 방어)
  let claimed
  try {
    claimed = await claimJobForRun(db, id)
  } catch {
    return jsonResponse({ ok: false, error: '작업 상태를 변경하지 못했습니다.' }, 500)
  }
  if (!claimed) {
    return jsonResponse({ ok: false, error: '이미 실행 중이거나 완료된 작업입니다.' }, 409)
  }

  const model = resolveModel(context.env)
  try {
    const { prompt, slug } = buildJobPrompt(job)
    const text = await callClaude(context.env, prompt, model)
    const article = parseGeneratedArticle(text, slug)
    const updated = await markJobCompleted(db, id, buildResultPayload(job, article, model))
    return jsonResponse({ ok: true, job: updated })
  } catch (e) {
    const message = safeErrorMessage(e)
    const updated = await markJobFailed(db, id, message).catch(() => null)
    return jsonResponse({ ok: false, error: message, job: updated }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
