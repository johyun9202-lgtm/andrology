// /api/domains/<siteId>/verify — 도메인 연결 검증 실행 (Phase 14C)
//
// - DNS 조회(DoH)·HTTPS 응답·Pages 연결 상태를 확인해 기록합니다.
// - 어떤 DNS도 변경하지 않습니다 (읽기 전용 검증).
// - DNS 전파 지연은 오류가 아니라 pending으로 처리합니다.
// - 검증 결과 verified가 되면 온보딩 작업 체크의 "도메인"을 완료로만 올립니다.
//   (직원이 이미 체크한 값을 내리지 않음)

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { verifyDomain } from '../../../_lib/domain-verifier.js'
import { getActiveConnection, updateConnection } from '../../../_lib/domain-repository.js'
import { upgradeOnboardingChecklistItem } from '../../../_lib/onboarding-repository.js'
import { resolveDomainSite, presentConnection } from '../[site].js'

export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDomainSite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  try {
    const connection = await getActiveConnection(db, resolved.siteId)
    if (!connection) {
      return jsonResponse({ ok: false, error: '등록된 도메인이 없습니다. 도메인을 먼저 저장해 주세요.' }, 400)
    }

    const result = await verifyDomain(context.env, connection)
    const updated = await updateConnection(db, connection.id, resolved.siteId, {
      dnsStatus: result.dnsStatus,
      httpsStatus: result.httpsStatus,
      pagesStatus: result.pagesStatus,
      verificationStatus: result.verificationStatus,
      deployReady: result.deployReady,
      actualDnsRecords: result.actualDnsRecords,
      lastCheckedAt: new Date().toISOString(),
      errorMessage: result.verificationStatus === 'error' ? String(result.detail?.dns ?? result.detail?.https ?? '') : '',
    })

    // 온보딩 체크 연동: verified일 때만 완료로 "올림" (내리지 않음)
    if (result.verificationStatus === 'verified') {
      await upgradeOnboardingChecklistItem(db, resolved.siteId, 'domain').catch(() => {})
    }

    return jsonResponse({
      ok: true,
      connection: presentConnection(updated),
      detail: result.detail,
      readinessReasons: result.readinessReasons,
    })
  } catch (e) {
    console.error(`[도메인 검증] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '검증 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
