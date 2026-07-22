// /api/domains/<siteId>/readiness — 배포 준비 상태 조회 (Phase 14C → Phase 15 연결)
//
// Phase 15 Deploy Engine이 별도 로직 없이 이 응답만으로
// 배포 가능 여부와 사유를 판단할 수 있도록 하는 service 계층입니다.

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../../_lib/db.js'
import { getActiveConnection } from '../../../_lib/domain-repository.js'
import { computeDeployReady } from '../../../_lib/domain-status.js'
import { resolveDomainSite } from '../[site].js'

export async function onRequestGet(context) {
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
      return jsonResponse({
        ok: true,
        readiness: {
          siteId: resolved.siteId,
          targetDomain: '',
          operationMode: resolved.onboarding?.operationMode ?? 'independent',
          deployReady: false,
          dnsStatus: 'unchecked',
          httpsStatus: 'unchecked',
          pagesStatus: 'unchecked',
          replacementApproved: false,
          validationErrors: ['등록된 도메인이 없습니다.'],
          expectedRecords: [],
          lastVerifiedAt: null,
        },
      })
    }
    const readiness = computeDeployReady({
      domain: connection.domain,
      dnsStatus: connection.dnsStatus,
      httpsStatus: connection.httpsStatus,
      operationMode: connection.operationMode,
      replacementApproved: connection.replacementApproved,
    })
    return jsonResponse({
      ok: true,
      readiness: {
        siteId: resolved.siteId,
        targetDomain: connection.domain,
        operationMode: connection.operationMode,
        deployReady: readiness.ready,
        dnsStatus: connection.dnsStatus,
        httpsStatus: connection.httpsStatus,
        pagesStatus: connection.pagesStatus,
        replacementApproved: connection.replacementApproved,
        validationErrors: readiness.reasons,
        expectedRecords: connection.expectedDnsRecords,
        lastVerifiedAt: connection.lastCheckedAt,
      },
    })
  } catch (e) {
    console.error(`[배포 준비 조회] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '배포 준비 상태를 불러오지 못했습니다.' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
