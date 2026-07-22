// /api/domains — 전체 활성 도메인 현황 (Phase 14C)
//
// 운영 현황판·Phase 15 Deploy Engine이 사이트별 도메인/배포 준비 상태를
// 한 번에 조회할 때 사용합니다. (관리자 인증 필수)

import { jsonResponse, methodNotAllowed, isAuthenticated } from '../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../_lib/db.js'
import { listActiveConnections } from '../_lib/domain-repository.js'
import { computeDeployReady, computeDomainProgress, VERIFICATION_LABELS } from '../_lib/domain-status.js'

export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)

  try {
    const connections = await listActiveConnections(db)
    return jsonResponse({
      ok: true,
      connections: connections.map((connection) => {
        const readiness = computeDeployReady({
          domain: connection.domain,
          dnsStatus: connection.dnsStatus,
          httpsStatus: connection.httpsStatus,
          operationMode: connection.operationMode,
          replacementApproved: connection.replacementApproved,
        })
        return {
          siteId: connection.siteId,
          domain: connection.domain,
          domainType: connection.domainType,
          operationMode: connection.operationMode,
          verificationStatus: connection.verificationStatus,
          statusLabel: VERIFICATION_LABELS[connection.verificationStatus] ?? connection.verificationStatus,
          deployReady: readiness.ready,
          progress: computeDomainProgress(connection).percent,
          lastCheckedAt: connection.lastCheckedAt,
        }
      }),
    })
  } catch (e) {
    console.error(`[도메인 목록] 조회 실패: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '도메인 목록을 불러오지 못했습니다. (0007 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
