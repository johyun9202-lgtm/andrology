// /api/domains/<siteId> — 도메인 설정 조회(GET)·저장(PUT) (Phase 14C Domain Wizard)
//
// - 관리자 인증 필수
// - 도메인 자동 구매·무단 DNS 변경 없음 (안내·기록·검증만)
// - 저장 시 온보딩(new_domain/domain_status)과 동기화 (하위 호환)
// - 같은 도메인의 타 사이트 중복 등록 차단, site_id별 활성 도메인 1개
// - 민감한 비밀번호·인증 코드는 저장하지 않습니다 (메모에도 넣지 마세요)

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../../_lib/auth.js'
import { getDb, dbUnavailableResponse } from '../../_lib/db.js'
import { normalizeDomain, classifyDomainType, checkModeCompatibility } from '../../_lib/domain-validate.js'
import { buildExpectedRecords, resolvePagesHost } from '../../_lib/domain-dns.js'
import { computeDomainProgress, computeDeployReady, VERIFICATION_LABELS, MANAGEMENT_TYPES } from '../../_lib/domain-status.js'
import { hasCloudflareApi } from '../../_lib/cloudflare-pages.js'
import {
  getActiveConnection, findActiveDomainOwner, deactivateSiteConnections,
  insertConnection, updateConnection, listConnectionHistory,
} from '../../_lib/domain-repository.js'
import { getOnboarding, updateOnboardingDomain } from '../../_lib/onboarding-repository.js'

const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (value, max) => String(value ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max)

// 사이트 확인: allowlist 또는 온보딩 레코드 존재 (재배포 전 신규 사이트 포함)
export async function resolveDomainSite(db, site) {
  const siteId = String(site ?? '')
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length > 30) return { error: 'siteId가 올바르지 않습니다.', status: 400 }
  if (ALLOWED_SITES.includes(siteId)) return { siteId, onboarding: await getOnboarding(db, siteId).catch(() => null) }
  const onboarding = await getOnboarding(db, siteId).catch(() => null)
  if (!onboarding) return { error: `등록되지 않은 사이트입니다: "${siteId}"`, status: 404 }
  return { siteId, onboarding }
}

// 응답용: 연결 + 진행률 + 배포 준비 판정
export function presentConnection(connection) {
  if (!connection) return null
  const progress = computeDomainProgress(connection)
  const readiness = computeDeployReady({
    domain: connection.domain,
    dnsStatus: connection.dnsStatus,
    httpsStatus: connection.httpsStatus,
    operationMode: connection.operationMode,
    replacementApproved: connection.replacementApproved,
  })
  return {
    ...connection,
    progress,
    readiness,
    statusLabel: VERIFICATION_LABELS[connection.verificationStatus] ?? connection.verificationStatus,
  }
}

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
    const history = await listConnectionHistory(db, resolved.siteId, 5)
    const warnings = connection
      ? checkModeCompatibility({
          domain: connection.domain,
          domainType: connection.domainType,
          operationMode: connection.operationMode,
          existingUrl: resolved.onboarding?.existingUrl ?? '',
        })
      : []
    return jsonResponse({
      ok: true,
      site: resolved.siteId,
      connection: presentConnection(connection),
      history: history.map((item) => ({
        id: item.id, domain: item.domain, active: item.active,
        verificationStatus: item.verificationStatus, deployReady: item.deployReady,
        lastCheckedAt: item.lastCheckedAt, createdAt: item.createdAt,
      })),
      warnings,
      onboarding: resolved.onboarding
        ? {
            hospitalName: resolved.onboarding.hospitalName,
            operationMode: resolved.onboarding.operationMode,
            existingUrl: resolved.onboarding.existingUrl,
          }
        : null,
      pagesHost: resolvePagesHost(context.env),
      apiMode: hasCloudflareApi(context.env),
      labels: { verification: VERIFICATION_LABELS, management: MANAGEMENT_TYPES },
    })
  } catch (e) {
    console.error(`[도메인 조회] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '도메인 설정을 불러오지 못했습니다. (0007 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, 20_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const db = getDb(context)
  if (!db) return dbUnavailableResponse(context)
  const resolved = await resolveDomainSite(db, context.params?.site)
  if (resolved.error) return jsonResponse({ ok: false, error: resolved.error }, resolved.status)

  // 관리 주체 필드 검증
  const managementType = ['client_managed', 'company_managed', 'unknown'].includes(body.managementType) ? body.managementType : 'unknown'
  const autoRenewStatus = ['on', 'off', 'unknown'].includes(body.autoRenewStatus) ? body.autoRenewStatus : 'unknown'
  const expiryDate = clean(body.expiryDate, 10)
  if (expiryDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return jsonResponse({ ok: false, error: '만료일은 YYYY-MM-DD 형식으로 입력해 주세요.' }, 400)
  }
  const management = {
    managementType,
    autoRenewStatus,
    expiryDate,
    registrarName: clean(body.registrarName, 60),
    nameserverStatus: clean(body.nameserverStatus, 80),
    notes: clean(body.notes, 500),
    replacementApproved: body.replacementApproved === true,
  }

  try {
    const rawDomain = String(body.domain ?? '').trim()
    const mode = resolved.onboarding?.operationMode ?? 'independent'

    // ----- 미정 저장: 활성 도메인 해제 + 온보딩 동기화 -----
    if (rawDomain === '') {
      await deactivateSiteConnections(db, resolved.siteId)
      await updateOnboardingDomain(db, resolved.siteId, { newDomain: '', domainStatus: 'undecided' }).catch(() => {})
      return jsonResponse({ ok: true, connection: null, warnings: [], note: '도메인 미정으로 저장했습니다. 결정되면 다시 입력해 주세요.' })
    }

    // ----- 정규화·검증 -----
    const normalized = normalizeDomain(rawDomain)
    if (normalized.error) return jsonResponse({ ok: false, error: normalized.error }, 400)
    const domain = normalized.domain
    const domainType = classifyDomainType(domain)
    const warnings = checkModeCompatibility({
      domain, domainType, operationMode: mode,
      existingUrl: resolved.onboarding?.existingUrl ?? '',
    })

    // 중복 등록 방지 (다른 사이트의 활성 도메인)
    const owner = await findActiveDomainOwner(db, domain, resolved.siteId)
    if (owner) {
      return jsonResponse({ ok: false, error: `이미 다른 사이트(${owner.siteId})에 등록된 도메인입니다: ${domain}` }, 409)
    }

    const expectedDnsRecords = buildExpectedRecords({
      domain, domainType, operationMode: mode,
      pagesHost: resolvePagesHost(context.env),
    })

    const existing = await getActiveConnection(db, resolved.siteId)
    let connection
    if (existing && existing.domain === domain) {
      // 같은 도메인: 관리 정보·승인·기대 레코드만 갱신 (검증 상태 유지)
      connection = await updateConnection(db, existing.id, resolved.siteId, {
        ...management,
        operationMode: mode,
        expectedDnsRecords,
        verificationStatus: existing.verificationStatus === 'domain_entered' ? 'dns_instructions_ready' : existing.verificationStatus,
        // replace 승인 해제 시 deploy_ready 재계산 (안전 우선)
        deployReady:
          existing.deployReady &&
          !(mode === 'replace' && !management.replacementApproved),
      })
    } else {
      // 새 도메인: 이전 행 보존(비활성) 후 새로 시작 (검증 상태 초기화)
      await deactivateSiteConnections(db, resolved.siteId)
      connection = await insertConnection(db, {
        id: `dom_${crypto.randomUUID()}`,
        siteId: resolved.siteId,
        domain, domainType, operationMode: mode,
        ...management,
        expectedDnsRecords,
      })
      connection = await updateConnection(db, connection.id, resolved.siteId, { verificationStatus: 'dns_instructions_ready' })
    }

    // 온보딩 동기화 (하위 호환 — new_domain/domain_status)
    await updateOnboardingDomain(db, resolved.siteId, { newDomain: domain, domainStatus: 'decided' }).catch(() => {})

    return jsonResponse({
      ok: true,
      connection: presentConnection(connection),
      warnings,
      note: '저장되었습니다. DNS 안내에 따라 레코드를 등록한 뒤 [검증 실행]을 눌러주세요. (자동으로 DNS를 변경하지 않습니다)',
    })
  } catch (e) {
    console.error(`[도메인 저장] 실패 site=${resolved.siteId}: ${e?.message ?? e}`)
    return jsonResponse({ ok: false, error: '도메인 설정을 저장하지 못했습니다. (0007 migration 적용 여부를 확인해 주세요)' }, 500)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
