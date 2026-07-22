// /api/seo-operations/tasks/<id> — 작업 상태 변경 (Phase 16)
//
// - 상태 전이 검증 (서버에서 재검증)
// - critical 작업 무시는 사유 필수
// - 완료(resolved)는 "완료 표시"일 뿐, 다음 점검에서 문제가 다시 발견되면
//   자동으로 reopened 처리됩니다 (해결 확정은 점검이 판정)
// - 무시(ignored)하면 연결된 finding도 무시되어 같은 작업이 재생성되지 않습니다.

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getTask, updateTask } from '../../../_lib/seo-repository.js'
import { canTaskTransition, validateTaskAction, TASK_STATUSES } from '../../../_lib/seo-status.js'

export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const id = String(context.params?.id ?? '')
  if (!/^tsk_[a-f0-9-]{36}$/.test(id)) return jsonResponse({ ok: false, error: '작업 id가 올바르지 않습니다.' }, 400)
  const body = await readJsonBody(context.request, 5_000)
  if (body === null || typeof body !== 'object') return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const task = await getTask(db, id)
    if (!task) return jsonResponse({ ok: false, error: '작업을 찾을 수 없습니다.' }, 404)
    const toStatus = String(body.status ?? '')
    if (!TASK_STATUSES.includes(toStatus)) return jsonResponse({ ok: false, error: '알 수 없는 상태값입니다.' }, 400)
    if (!canTaskTransition(task.status, toStatus)) {
      return jsonResponse({ ok: false, error: `현재 상태(${task.status})에서 ${toStatus}(으)로 변경할 수 없습니다.` }, 400)
    }
    const note = String(body.note ?? '').trim().slice(0, 400)
    const actionError = validateTaskAction({ toStatus, severity: task.severity, note })
    if (actionError) return jsonResponse({ ok: false, error: actionError }, 400)

    const now = new Date().toISOString()
    const fields = { status: toStatus }
    if (note !== '') fields.resolutionNote = note
    if (toStatus === 'resolved') {
      fields.resolvedAt = now
      if (note === '') fields.resolutionNote = '완료 표시 (다음 점검에서 해결 여부 확인)'
    }
    if (toStatus === 'reopened') fields.resolvedAt = null
    if (body.assignedTo !== undefined) fields.assignedTo = String(body.assignedTo ?? '').slice(0, 40)
    if (body.dueDate !== undefined) fields.dueDate = String(body.dueDate ?? '').slice(0, 10)
    const updated = await updateTask(db, id, fields)

    // finding 동기화: 무시 → finding도 ignored / 다시 열기 → finding open
    if (task.findingId !== '' && (toStatus === 'ignored' || toStatus === 'reopened')) {
      await db
        .prepare(`UPDATE seo_findings SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(toStatus === 'ignored' ? 'ignored' : 'open', now, task.findingId)
        .run()
    }

    return jsonResponse({
      ok: true,
      task: updated,
      note: toStatus === 'resolved'
        ? '완료로 표시했습니다. 다음 점검에서 문제가 사라지면 해결이 확정되고, 다시 발견되면 자동으로 다시 열립니다.'
        : undefined,
    })
  } catch (e) {
    console.error(`[SEO 작업 변경] 실패 id=${id}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '작업 상태를 변경하지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
