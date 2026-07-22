// /api/seo-operations/run-all — 운영 사이트 전체 점검 (batch, Phase 16)
//
// 안전 기준: 병렬 실행 없음(순차), 호출 1회당 최대 SEO_CHECK_BATCH(기본 3)개,
// 마지막 점검이 오래된 사이트부터, paused·비대상 제외, 개별 실패가 batch를
// 중단하지 않음. 스케줄러(Cron)도 이 엔드포인트를 반복 호출하면 됩니다.

import { jsonResponse, methodNotAllowed, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { listOnboarding } from '../../_lib/onboarding-repository.js'
import { runSeoCheck } from '../../_lib/seo-runner.js'
import { findActiveRun, latestRunForSite } from '../../_lib/seo-repository.js'
import { siteOperabilityContext } from './[site].js'

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const batchSize = Math.min(5, Math.max(1, Number(context.env?.SEO_CHECK_BATCH) || 3))
    const onboardingRecords = await listOnboarding(db).catch(() => [])
    const byId = new Map(onboardingRecords.map((record) => [record.siteId, record]))
    const siteIds = [...new Set([...ALLOWED_SITES, ...byId.keys()])]

    // 점검 가능 사이트 + 마지막 점검 시각 수집
    const candidates = []
    for (const siteId of siteIds) {
      const { classification } = await siteOperabilityContext(db, siteId, byId.get(siteId) ?? null)
      if (!classification.checkable) continue
      if (await findActiveRun(db, siteId)) continue
      const latest = await latestRunForSite(db, siteId).catch(() => null)
      candidates.push({ siteId, lastCheckedAt: latest?.completedAt ?? '' })
    }
    candidates.sort((a, b) => a.lastCheckedAt.localeCompare(b.lastCheckedAt)) // 오래된 순

    const batch = candidates.slice(0, batchSize)
    const results = []
    for (const { siteId } of batch) {
      try {
        const { run } = await runSeoCheck(context.env, db, siteId, { triggerType: 'manual' })
        results.push({ siteId, status: run.status, score: run.overallScore, findings: run.findingsCount })
      } catch (e) {
        // 개별 실패는 기록만 하고 계속 진행
        results.push({ siteId, status: 'failed', error: String(e?.message ?? e).slice(0, 120) })
      }
    }
    return jsonResponse({
      ok: true,
      checked: results,
      remaining: Math.max(0, candidates.length - batch.length),
      note: candidates.length > batch.length
        ? `이번 실행에서 ${batch.length}개를 점검했습니다. 남은 ${candidates.length - batch.length}개는 [전체 점검]을 다시 눌러 이어서 점검하세요.`
        : '점검 가능한 사이트를 모두 점검했습니다.',
    })
  } catch (e) {
    console.error(`[SEO 전체 점검] 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '전체 점검 중 오류가 발생했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
