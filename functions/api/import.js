// /api/import — Hospital Import 실행(POST)·조회(GET) (Phase 14B)
//
// - 관리자 인증 필수, medical 템플릿 사이트만 허용
// - POST: 기존 홈페이지를 제한 수집하고 결과를 D1(import_jobs)에 "원본 기록"으로 저장
//   (hospital.json에는 절대 자동 반영하지 않음 — 적용은 /api/import/apply)
// - GET: 최신 Import 결과(전체) + 과거 이력(메타)
// - sourceUrl 미지정 시 온보딩(site_onboarding)의 existing_url을 사용

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import { SITE_DATA } from '../_lib/site-data.generated.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { runImportCrawl } from '../_lib/import-crawler.js'
import { insertImportJob, completeImportJob, failImportJob, latestImportForSite, listImportHistory, getImportJob } from '../_lib/import-repository.js'
import { getOnboarding } from '../_lib/onboarding-repository.js'

function resolveMedicalSite(site) {
  if (!ALLOWED_SITES.includes(site)) return { error: '허용되지 않는 사이트입니다.', status: 400 }
  const template = SITE_DATA[site]?.template ?? 'medical'
  if (template !== 'medical') {
    return { error: '병원 Import는 medical 템플릿 사이트에서만 사용할 수 있습니다.', status: 400 }
  }
  return { site }
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const resolved = resolveMedicalSite(new URL(context.request.url).searchParams.get('site') ?? '')
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const [latest, history, onboarding] = await Promise.all([
      latestImportForSite(db, resolved.site),
      listImportHistory(db, resolved.site, 5),
      getOnboarding(db, resolved.site).catch(() => null),
    ])
    return jsonResponse({
      ok: true,
      site: resolved.site,
      latest,
      history,
      defaultSourceUrl: onboarding?.existingUrl ?? '',
    })
  } catch (e) {
    console.error(`[Import 조회] 실패 site=${resolved.site}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: 'Import 이력을 불러오지 못했습니다.' }, 500)
  }
}

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, 10_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const resolved = resolveMedicalSite(typeof body.site === 'string' ? body.site : '')
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  // 수집 대상 URL: 직접 입력 > 온보딩 existing_url
  let sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
  if (sourceUrl === '') {
    const onboarding = await getOnboarding(db, resolved.site).catch(() => null)
    sourceUrl = onboarding?.existingUrl ?? ''
  }
  if (sourceUrl === '') {
    return jsonResponse(
      { ok: false, error: '기존 홈페이지 URL이 없습니다. 온보딩에 등록하거나 직접 입력해 주세요.' },
      400
    )
  }
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return jsonResponse({ ok: false, error: 'URL 형식이 올바르지 않습니다. (http:// 또는 https:// 로 시작)' }, 400)
  }

  const id = `imp_${crypto.randomUUID()}`
  try {
    await insertImportJob(db, { id, siteId: resolved.site, sourceUrl })
  } catch (e) {
    console.error(`[Import 시작] 기록 실패 site=${resolved.site}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: 'Import 작업을 시작하지 못했습니다. (0006 migration 적용 여부를 확인해 주세요)' }, 500)
  }

  try {
    const crawl = await runImportCrawl(context.env, sourceUrl)
    if (crawl.status === 'failed') {
      await failImportJob(db, id, crawl.error)
    } else {
      await completeImportJob(db, id, {
        status: crawl.status,
        sourceUrl: crawl.sourceUrl,
        pagesScanned: crawl.pages.length,
        pagesFailed: crawl.pages.filter((page) => !page.ok).length,
        score: crawl.score.percent,
        result: {
          candidates: crawl.candidates,
          pages: crawl.pages,
          score: crawl.score,
          missing: crawl.score.missing,
          warning: crawl.warning ?? null,
        },
      })
    }
    const record = await getImportJob(db, id)
    return jsonResponse({ ok: true, record })
  } catch (e) {
    console.error(`[Import 실행] 실패 site=${resolved.site} id=${id}: ${e?.message ?? e}`)
    await failImportJob(db, id, '수집 중 오류가 발생했습니다.').catch(() => {})
    return jsonResponse({ ok: false, error: 'Import 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
