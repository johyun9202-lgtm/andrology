// /api/entities — 진료과·의료진 엔티티 조회(GET) / 저장(PUT) — Phase 13
//
// 내부 SEO 운영 도구용 API입니다. 운영자가 입력한 실제 정보만 저장하며,
// 저장 시 기존 hospital.json의 다른 필드(articles/nav/schema/theme/faq/cta/
// 기존 단일 doctor 필드 등)는 전부 보존됩니다. (site-settings와 동일한 merge 방식)
//
// - 관리자 인증 필수, site allowlist, medical template 사이트만 허용
// - 검증·양방향 관계 정규화는 functions/_lib/entities.js (순수 모듈)
// - GitHub 저장은 기존 Publisher 헬퍼 재사용 (sha 기반 — 동시 수정 409)

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import { SITE_DATA } from '../_lib/site-data.generated.js'
import { resolveGitHubConfig, githubFetch, githubErrorMessage, utf8ToBase64 } from '../_lib/publisher.js'
import { readHospitalFile } from './site-settings.js'
import { validateEntities } from '../_lib/entities.js'
import { safeErrorMessage } from '../_lib/ai-writer.js'
import { runSeoCheck } from '../../scripts/lib/seo-checker.mjs'
import { normalizeSiteUrl } from '../../src/lib/site-url.js'

const MAX_BODY_BYTES = 300_000

function resolveMedicalSite(site) {
  if (!ALLOWED_SITES.includes(site)) return { error: '허용되지 않는 사이트입니다.', status: 400 }
  const template = SITE_DATA[site]?.template ?? 'medical'
  if (template !== 'medical') {
    return { error: '진료과·의료진 관리는 medical 템플릿 사이트에서만 사용할 수 있습니다.', status: 400 }
  }
  return { site }
}

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const params = new URL(context.request.url).searchParams
  const resolved = resolveMedicalSite(params.get('site') ?? 'aiseolab')
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const { hospital, sha } = await readHospitalFile(config, resolved.site)
    let siteUrl = ''
    try { siteUrl = normalizeSiteUrl(hospital.site?.url) } catch { /* 미설정 허용 */ }
    return jsonResponse({
      ok: true,
      site: resolved.site,
      departments: Array.isArray(hospital.departments) ? hospital.departments : [],
      doctors: Array.isArray(hospital.doctors) ? hospital.doctors : [],
      sha,
      siteUrl,
    })
  } catch (e) {
    return jsonResponse({ ok: false, error: safeErrorMessage(e) }, 500)
  }
}

export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, MAX_BODY_BYTES)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const resolved = resolveMedicalSite(typeof body.site === 'string' ? body.site : '')
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  const validated = validateEntities({ departments: body.departments, doctors: body.doctors })
  if (validated.errors) {
    return jsonResponse({ ok: false, error: validated.errors.slice(0, 3).join(' ') }, 400)
  }

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const { hospital, sha, filePath } = await readHospitalFile(config, resolved.site)
    if (typeof body.sha === 'string' && body.sha !== '' && body.sha !== sha) {
      return jsonResponse({ ok: false, error: '데이터가 다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }, 409)
    }

    // merge: departments/doctors만 교체 — 그 외 모든 필드(기존 doctor 포함) 보존
    const merged = JSON.parse(JSON.stringify(hospital))
    merged.departments = validated.departments
    merged.doctors = validated.doctors

    const seoResult = runSeoCheck(merged, resolved.site, { print: false })
    if (seoResult.errors.length > 0) {
      return jsonResponse({ ok: false, error: `SEO 검사를 통과하지 못했습니다: ${seoResult.errors[0]}` }, 422)
    }

    const putResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update entities: ${resolved.site}`,
        content: utf8ToBase64(JSON.stringify(merged, null, 2) + '\n'),
        sha,
        branch: config.branch,
      }),
    })
    if (!putResponse.ok) throw new Error(githubErrorMessage(putResponse.status, putResponse.headers))
    const putResult = await putResponse.json().catch(() => null)
    const commitSha = putResult?.commit?.sha
    if (typeof commitSha !== 'string' || commitSha === '') {
      throw new Error('GitHub 커밋 결과를 확인하지 못했습니다. 저장소에서 커밋 이력을 확인해 주세요.')
    }

    let siteUrl = ''
    try { siteUrl = normalizeSiteUrl(merged.site?.url) } catch { /* 미설정 허용 */ }
    return jsonResponse({
      ok: true,
      site: resolved.site,
      commitSha,
      departments: validated.departments,
      doctors: validated.doctors,
      siteUrl,
      note: '저장되었습니다. 재배포(1~2분) 후 진료과·의료진 페이지가 갱신됩니다.',
    })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[엔티티 저장 실패] site=${resolved.site} message=${message}`)
    const status = message.includes('충돌') || message.includes('변경되어') ? 409 : 500
    return jsonResponse({ ok: false, error: message }, status)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
