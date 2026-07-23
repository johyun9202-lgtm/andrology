// /api/seo-operations/tasks — 작업 목록 (오늘의 할 일, Phase 16)
//
// priority_score 내림차순. 병원별 쏠림 방지를 위해 perSiteCap(기본 3)을 지원합니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { listTasks } from '../../_lib/seo-repository.js'
import { SEVERITY_LABELS } from '../../_lib/seo-status.js'

const OPEN_STATUSES = ['open', 'acknowledged', 'in_progress', 'reopened']

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const params = new URL(context.request.url).searchParams
    const site = params.get('site') ?? ''
    const status = params.get('status') ?? ''
    const severity = params.get('severity') ?? ''
    const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 50))
    const perSiteCap = Math.max(0, Number(params.get('perSiteCap')) || 0)

    const statuses = status !== '' ? [status] : OPEN_STATUSES
    let tasks = await listTasks(db, { siteId: site, statuses, severity, limit: 100 })

    // 병원별 쏠림 방지 (perSiteCap > 0일 때 사이트당 최대 N개)
    if (perSiteCap > 0) {
      const perSite = new Map()
      tasks = tasks.filter((task) => {
        const count = perSite.get(task.siteId) ?? 0
        if (count >= perSiteCap) return false
        perSite.set(task.siteId, count + 1)
        return true
      })
    }
    tasks = tasks.slice(0, limit)
    return jsonResponse({ ok: true, tasks, labels: { severity: SEVERITY_LABELS } })
  } catch (e) {
    console.error(`[SEO 작업 목록] 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '작업 목록을 불러오지 못했습니다. (0009 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
