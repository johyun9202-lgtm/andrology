// ============================================================
// Domain 상태·진행률·배포 준비 판정 — 순수 함수 (Phase 14C)
//
// 상태값은 이 파일 한 곳에서만 정의합니다.
// ============================================================

export const VERIFICATION_STATUSES = [
  'undecided', 'domain_entered', 'dns_instructions_ready', 'dns_pending',
  'dns_mismatch', 'pages_pending', 'https_pending', 'verified', 'manual_review', 'error',
]

export const VERIFICATION_LABELS = {
  undecided: '미입력',
  domain_entered: '입력 완료',
  dns_instructions_ready: 'DNS 안내 준비됨',
  dns_pending: 'DNS 대기',
  dns_mismatch: 'DNS 불일치',
  pages_pending: 'Pages 연결 대기',
  https_pending: 'HTTPS 대기',
  verified: '연결 완료',
  manual_review: '수동 확인 필요',
  error: '오류',
}

export const MANAGEMENT_TYPES = {
  client_managed: '병원(고객) 관리',
  company_managed: '우리 회사 관리',
  unknown: '미확인',
}

// 검증 결과 → 대표 상태 (검증 전에는 입력 단계 기준)
export function computeVerificationStatus({ domain, hasExpectedRecords, dnsStatus, httpsStatus, pagesStatus }) {
  if (!domain) return 'undecided'
  if (!hasExpectedRecords) return 'domain_entered'
  if (dnsStatus === 'unchecked' || dnsStatus === undefined) return 'dns_instructions_ready'
  if (dnsStatus === 'error') return 'error'
  if (dnsStatus === 'mismatch') return 'dns_mismatch'
  if (dnsStatus === 'pending') return 'dns_pending'
  if (dnsStatus === 'manual') return 'manual_review'
  // dnsStatus === 'ok'
  if (httpsStatus === 'error') return 'error'
  if (httpsStatus !== 'ok') return 'https_pending'
  if (pagesStatus === 'pending') return 'pages_pending'
  if (pagesStatus === 'error') return 'manual_review'
  // pages: connected | manual(수동 확인) | unchecked → HTTPS까지 됐으면 연결 완료로 판단
  return 'verified'
}

// 진행률 — 실제 연결 상태 기반 (도메인 20 / 관리 주체 20 / DNS 기대값 20 / DNS 검증 20 / HTTPS·Pages 20)
export function computeDomainProgress(connection) {
  const c = connection ?? {}
  let percent = 0
  const steps = []
  const add = (label, done) => {
    if (done) percent += 20
    steps.push({ label, done: !!done })
  }
  add('도메인 입력', !!c.domain)
  add('관리 주체 확인', c.managementType === 'client_managed' || c.managementType === 'company_managed')
  add('DNS 기대값 생성', Array.isArray(c.expectedDnsRecords) && c.expectedDnsRecords.length > 0)
  add('DNS 검증', c.dnsStatus === 'ok')
  add('HTTPS·Pages 확인', c.httpsStatus === 'ok')
  return { percent, steps }
}

// 배포 준비(deploy_ready) 판정 — Phase 15 Deploy Engine의 선행 조건.
// 반환: { ready, reasons: [미충족 사유] }
export function computeDeployReady(connection) {
  const c = connection ?? {}
  const reasons = []
  if (!c.domain) reasons.push('유효한 도메인이 없습니다.')
  if (c.dnsStatus !== 'ok') reasons.push('DNS 검증이 완료되지 않았습니다.')
  if (c.httpsStatus !== 'ok') reasons.push('HTTPS 확인이 완료되지 않았습니다.')
  if (c.mappingConfirmed === false) reasons.push('도메인이 대상 사이트로 응답하는지 확인되지 않았습니다.')
  if (c.operationMode === 'replace' && !c.replacementApproved) {
    reasons.push('기존 홈페이지 교체 모드는 전환 승인 체크가 필요합니다.')
  }
  return { ready: reasons.length === 0, reasons }
}
