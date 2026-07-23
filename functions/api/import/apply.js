// /api/import/apply — 검토·승인된 Import 항목만 hospital.json에 병합 (Phase 14B)
//
// - 관리자 인증 필수, medical 템플릿 사이트만 허용
// - importId의 site_id와 요청 site가 일치해야 함 (다른 사이트 기록으로 적용 불가)
// - sha 기반 낙관적 잠금 (다른 곳에서 수정된 경우 409)
// - 선택(selections)에 명시된 필드만 병합 — 나머지는 전부 보존
// - 커밋 후 import_jobs에 적용 이력 기록

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { SITE_DATA } from '../../_lib/site-data.generated.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { resolveGitHubConfig, githubFetch, githubErrorMessage, utf8ToBase64 } from '../../_lib/publisher.js'
import { readHospitalFile } from '../site-settings.js'
import { applyImportSelections } from '../../_lib/import-apply.js'
import { getImportJob, markImportApplied } from '../../_lib/import-repository.js'
import { safeErrorMessage } from '../../_lib/ai-writer.js'

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, 30_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  const site = typeof body.site === 'string' && ALLOWED_SITES.includes(body.site) ? body.site : null
  if (!site) return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)
  if ((SITE_DATA[site]?.template ?? 'medical') !== 'medical') {
    return jsonResponse({ ok: false, error: '병원 Import는 medical 템플릿 사이트에서만 사용할 수 있습니다.' }, 400)
  }

  const importId = typeof body.importId === 'string' ? body.importId : ''
  if (!/^imp_[a-f0-9-]{36}$/.test(importId)) {
    return jsonResponse({ ok: false, error: 'importId가 올바르지 않습니다.' }, 400)
  }

  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    // 1) Import 기록 확인 — 다른 site_id의 기록으로는 적용 불가
    const importJob = await getImportJob(db, importId)
    if (!importJob || importJob.siteId !== site) {
      return jsonResponse({ ok: false, error: '해당 사이트의 Import 기록을 찾을 수 없습니다.' }, 404)
    }
    if (importJob.status !== 'completed' && importJob.status !== 'partial_success') {
      return jsonResponse({ ok: false, error: '완료된 Import만 적용할 수 있습니다.' }, 400)
    }

    // 2) 현재 hospital.json 읽기 + 동시 수정 감지
    const { hospital, sha, filePath } = await readHospitalFile(config, site)
    if (typeof body.sha === 'string' && body.sha !== '' && body.sha !== sha) {
      return jsonResponse(
        { ok: false, error: '다른 곳에서 사이트 설정이 수정되었습니다. 검토 화면을 새로고침 후 다시 적용해 주세요.', sha },
        409
      )
    }

    // 3) 선택 항목 검증·병합 (실패 시 아무것도 적용하지 않음)
    const applied = applyImportSelections(hospital, body.selections)
    if (applied.errors) {
      return jsonResponse({ ok: false, error: applied.errors.slice(0, 3).join(' ') }, 400)
    }

    // 4) GitHub 커밋 (sha 기반 갱신)
    const content = JSON.stringify(applied.hospital, null, 2) + '\n'
    const response = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Apply import: ${site} (${applied.appliedFields.join(', ')})`,
        content: utf8ToBase64(content),
        sha,
        branch: config.branch,
      }),
    })
    if (!response.ok) {
      if (response.status === 409) {
        return jsonResponse({ ok: false, error: '다른 곳에서 파일이 수정되었습니다. 새로고침 후 다시 적용해 주세요.' }, 409)
      }
      throw new Error(githubErrorMessage(response.status, response.headers))
    }
    const result = await response.json().catch(() => null)
    const commitSha = result?.commit?.sha ?? ''

    // 5) 적용 이력 기록 (실패해도 커밋은 유효 — 로그만)
    await markImportApplied(db, importId, site, applied.appliedFields).catch((e) =>
      console.error(`[Import 적용] 이력 기록 실패 id=${importId}: ${e?.message ?? e}`)
    )

    return jsonResponse({
      ok: true,
      commitSha,
      appliedFields: applied.appliedFields,
      note: '적용 완료 — 재배포(1~2분) 후 사이트에 반영됩니다. 빌드·SEO 검사는 배포 파이프라인에서 자동 수행됩니다.',
    })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[Import 적용 실패] site=${site} import=${importId} message=${message}`)
    return jsonResponse({ ok: false, error: message }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
