// /api/onboarding/<siteId> — 온보딩 개별 조회(GET)·수정(PUT) (Phase 14A)
//
// - 관리자 인증 필수
// - 레코드는 사이트 생성 마법사(POST /api/sites)에서 만들어집니다.
// - Phase 14A 이전에 만든 기존 사이트(allowlist에 있는 사이트)는
//   레코드가 없어도 PUT 시 새로 생성(upsert)해 진행률 관리에 포함할 수 있습니다.

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { getOnboarding, insertOnboarding, updateOnboarding } from '../../_lib/onboarding-repository.js'
import { validateOnboardingInput } from '../../_lib/onboarding.js'
import { resolveGitHubConfig, githubFetch } from '../../_lib/publisher.js'

// 레코드·allowlist에 없는 siteId — 저장소에 실제 존재하는 사이트인지 확인
// (마법사 생성 직후 D1 저장만 실패한 경우의 재저장 경로. 재배포 전이라 allowlist에 없음)
async function siteExistsInRepo(env, siteId) {
  const config = resolveGitHubConfig(env)
  if (!config.ok) return false
  try {
    const response = await githubFetch(
      config,
      `/repos/${config.owner}/${config.repo}/contents/${config.basePath}/${siteId}/hospital.json?ref=${encodeURIComponent(config.branch)}`
    )
    return response.status === 200
  } catch {
    return false
  }
}

const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function invalidSiteResponse(siteId) {
  return jsonResponse({ ok: false, error: `siteId가 올바르지 않습니다: "${String(siteId).slice(0, 40)}"` }, 400)
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const siteId = String(context.params?.site ?? '')
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length > 30) return invalidSiteResponse(siteId)

  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const record = await getOnboarding(db, siteId)
    if (!record) {
      return jsonResponse({ ok: false, error: `온보딩 정보가 없습니다: "${siteId}"` }, 404)
    }
    return jsonResponse({ ok: true, record })
  } catch (e) {
    console.error(`[온보딩 조회] 실패 site=${siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '온보딩 정보를 불러오지 못했습니다.' }, 500)
  }
}

export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const siteId = String(context.params?.site ?? '')
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length > 30) return invalidSiteResponse(siteId)

  const body = await readJsonBody(context.request, 20_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  const validated = validateOnboardingInput(body)
  if (validated.errors) {
    return jsonResponse({ ok: false, error: validated.errors.join(' ') }, 400)
  }

  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const existing = await getOnboarding(db, siteId)
    let record
    if (existing) {
      record = await updateOnboarding(db, siteId, validated.value)
    } else if (ALLOWED_SITES.includes(siteId) || (await siteExistsInRepo(context.env, siteId))) {
      // 레코드 없는 기존 사이트 또는 D1 저장만 실패했던 신규 사이트 — 온보딩 관리에 편입
      record = await insertOnboarding(db, siteId, validated.value)
    } else {
      return jsonResponse(
        { ok: false, error: `온보딩 정보가 없습니다: "${siteId}" (사이트 생성 마법사로 먼저 생성해 주세요)` },
        404
      )
    }
    return jsonResponse({ ok: true, record })
  } catch (e) {
    console.error(`[온보딩 저장] 실패 site=${siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '온보딩 정보를 저장하지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
