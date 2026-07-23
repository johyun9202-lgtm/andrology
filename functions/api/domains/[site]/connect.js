// /api/domains/<siteId>/connect — Pages Custom Domain 추가 (API Mode 전용, Phase 14C)
//
// - 사용자가 [Pages에 연결] 버튼을 눌렀을 때만 실행 (자동 실행 없음)
// - Cloudflare API Token이 없으면 Manual Mode 안내와 함께 거절
// - Custom Domain "추가"만 수행 — 삭제·DNS 변경은 이번 Phase에 없음
// - 실패 시 Manual Mode(대시보드 직접 연결)로 안내

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { hasCloudflareApi, addPagesCustomDomain, pagesStatusFor } from '../../../_lib/cloudflare-pages.js'
import { getActiveConnection, updateConnection } from '../../../_lib/domain-repository.js'
import { resolveDomainSite, presentConnection } from '../[site].js'

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDomainSite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  if (!hasCloudflareApi(context.env)) {
    return jsonResponse(
      { ok: false, error: 'Cloudflare API Token이 설정되지 않았습니다. Cloudflare Dashboard → Pages → Custom domains에서 직접 추가해 주세요. (Manual Mode)' },
      400
    )
  }

  try {
    const connection = await getActiveConnection(db, resolved.siteId)
    if (!connection) {
      return jsonResponse({ ok: false, error: '등록된 도메인이 없습니다. 도메인을 먼저 저장해 주세요.' }, 400)
    }

    const added = await addPagesCustomDomain(context.env, connection.domain)
    if (!added.ok) return jsonResponse({ ok: false, error: added.error }, 502)

    const pages = await pagesStatusFor(context.env, connection.domain)
    const updated = await updateConnection(db, connection.id, resolved.siteId, { pagesStatus: pages.status })
    return jsonResponse({
      ok: true,
      connection: presentConnection(updated),
      note: added.already
        ? '이미 Pages Custom Domain에 등록되어 있습니다. [검증 실행]으로 연결 상태를 확인해 주세요.'
        : 'Pages Custom Domain 추가를 요청했습니다. DNS 안내에 따라 레코드 등록 후 [검증 실행]으로 확인해 주세요.',
    })
  } catch (e) {
    console.error(`[Pages 연결] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: 'Pages 연결 요청 중 오류가 발생했습니다. Cloudflare Dashboard에서 직접 진행해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
