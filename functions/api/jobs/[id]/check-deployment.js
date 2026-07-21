// POST /api/jobs/:id/check-deployment — 게시/삭제가 실제 사이트에 반영되었는지 확인
//
// - 관리자 인증 필수
// - GitHub 커밋이 완료된 작업(published/deleted)만 확인 가능
// - 요청 URL은 사이트 설정(site.url) + 검증된 slug로만 서버가 조립 (SSRF 방지)
// - published: 200+HTML+slug 확인 → deployed / 404 → pending 유지 / 그 외 → deploy_failed
// - deleted:   404 → deployed(삭제 반영) / 200 → pending
// - 응답 본문은 저장하지 않고 상태·시각·시도 횟수만 D1에 기록

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getJob, markDeploymentChecked } from '../../../_lib/job-repository.js'
import { checkDeployment } from '../../../_lib/publisher.js'

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

  if (job.publishStatus !== 'published' && job.publishStatus !== 'deleted') {
    return jsonResponse({ ok: false, error: 'GitHub 커밋이 완료된 작업만 배포 확인을 할 수 있습니다.' }, 409)
  }

  const result = await checkDeployment(context.env, job)
  try {
    const updated = await markDeploymentChecked(db, id, {
      status: result.status === 'pending' ? 'pending' : result.status,
      error: result.status === 'deployed' ? null : result.note,
    })
    return jsonResponse({ ok: true, deployment: result, job: updated })
  } catch {
    return jsonResponse({ ok: false, error: '확인 결과를 저장하지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
