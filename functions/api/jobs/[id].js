// /api/jobs/:id — 단일 Job 조회(GET) 및 상태 변경(PATCH)
//
// - 로그인 세션 필수 (서버에서 재검증)
// - PATCH body: { status?, progress?, result?, error? }
//   status는 queued/running/completed/failed 만 허용

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../_lib/auth.js'
import { getJob, updateJob, JOB_STATUSES } from '../../_lib/job-repository.js'

const JOB_ID_PATTERN = /^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_TEXT_LENGTH = 10_000

function dbOf(context) {
  const db = context.env?.DB
  return db && typeof db.prepare === 'function' ? db : null
}

function validJobId(params) {
  const id = typeof params?.id === 'string' ? params.id : ''
  return JOB_ID_PATTERN.test(id) ? id : null
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = dbOf(context)
  if (!db) return jsonResponse({ ok: false, error: '서버 저장소 설정이 완료되지 않았습니다.' }, 500)

  const id = validJobId(context.params)
  if (!id) return jsonResponse({ ok: false, error: '올바르지 않은 작업 ID입니다.' }, 400)

  try {
    const job = await getJob(db, id)
    if (!job) return jsonResponse({ ok: false, error: '작업을 찾을 수 없습니다.' }, 404)
    return jsonResponse({ ok: true, job })
  } catch {
    return jsonResponse({ ok: false, error: '작업을 불러오지 못했습니다.' }, 500)
  }
}

export async function onRequestPatch(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = dbOf(context)
  if (!db) return jsonResponse({ ok: false, error: '서버 저장소 설정이 완료되지 않았습니다.' }, 500)

  const id = validJobId(context.params)
  if (!id) return jsonResponse({ ok: false, error: '올바르지 않은 작업 ID입니다.' }, 400)

  const body = await readJsonBody(context.request, 20_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  const patch = {}

  if (body.status !== undefined) {
    if (!JOB_STATUSES.includes(body.status)) {
      return jsonResponse({ ok: false, error: `status는 ${JOB_STATUSES.join('/')} 중 하나여야 합니다.` }, 400)
    }
    patch.status = body.status
  }

  if (body.progress !== undefined) {
    const progress = Number(body.progress)
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      return jsonResponse({ ok: false, error: 'progress는 0~100 사이의 정수여야 합니다.' }, 400)
    }
    patch.progress = progress
  }

  for (const field of ['result', 'error']) {
    if (body[field] !== undefined) {
      if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > MAX_TEXT_LENGTH)) {
        return jsonResponse({ ok: false, error: `${field}는 ${MAX_TEXT_LENGTH}자 이내의 문자열이어야 합니다.` }, 400)
      }
      patch[field] = body[field]
    }
  }

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ ok: false, error: '변경할 항목이 없습니다.' }, 400)
  }

  try {
    const job = await updateJob(db, id, patch)
    if (!job) return jsonResponse({ ok: false, error: '작업을 찾을 수 없습니다.' }, 404)
    return jsonResponse({ ok: true, job })
  } catch {
    return jsonResponse({ ok: false, error: '작업 상태 변경에 실패했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
