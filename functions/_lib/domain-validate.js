// ============================================================
// Domain 정규화·검증 — 순수 함수 (Phase 14C Domain Wizard)
//
// 배포 대상 도메인(호스트명)만 다룹니다. path/query/fragment는 거부하며,
// IP·내부망·localhost도 거부합니다. 국제화 도메인은 URL API로 punycode 정규화.
// ============================================================

// 한국 등 자주 쓰는 2단계 공용 접미사 (registrable domain 판별용 — 필요 시 추가)
const MULTI_PART_TLDS = new Set([
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'pe.kr', 'go.kr', 'ac.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr', 'kg.kr',
  'co.jp', 'ne.jp', 'or.jp', 'com.cn', 'com.tw',
])

const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

// 입력(문자열)을 정규화된 도메인으로. 반환: { domain, error? }
// - 프로토콜·trailing dot·공백 제거, 소문자, punycode 정규화(URL API)
// - path/query/fragment 포함 시 거부
// - localhost·IP(사설 포함)·잘못된 라벨·연속된 점 거부
export function normalizeDomain(input) {
  let raw = String(input ?? '').trim().replace(/\s+/g, '')
  if (raw === '') return { error: '도메인을 입력해 주세요.' }
  raw = raw.replace(/^https?:\/\//i, '')
  // path/query/fragment/포트/인증정보 거부 (프로토콜 제거 후 남아 있으면 안 됨)
  if (/[/?#@]/.test(raw)) return { error: '도메인만 입력해 주세요. (경로·물음표·# 제외 — 예: brightclinic.co.kr)' }
  if (raw.includes(':')) return { error: '포트나 IPv6 주소는 사용할 수 없습니다. 도메인만 입력해 주세요.' }
  raw = raw.replace(/\.+$/, '') // trailing dot
  if (raw === '') return { error: '도메인을 입력해 주세요.' }
  if (raw.includes('..')) return { error: '도메인에 연속된 점(..)은 사용할 수 없습니다.' }

  // punycode 정규화 (한글 도메인 → xn--)
  let hostname
  try {
    hostname = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return { error: '도메인 형식이 올바르지 않습니다. (예: brightclinic.co.kr)' }
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { error: '내부 주소는 배포 도메인으로 사용할 수 없습니다.' }
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { error: 'IP 주소는 사용할 수 없습니다. 도메인 이름을 입력해 주세요.' }
  }

  const labels = hostname.split('.')
  if (labels.length < 2) return { error: '최상위 도메인을 포함해 입력해 주세요. (예: brightclinic.co.kr)' }
  for (const label of labels) {
    if (label.length < 1 || label.length > 63 || !LABEL_PATTERN.test(label)) {
      return { error: `도메인 형식이 올바르지 않습니다: "${label}" 부분을 확인해 주세요. (영문·숫자·하이픈, 하이픈으로 시작·끝 불가)` }
    }
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]) && !labels[labels.length - 1].startsWith('xn--')) {
    return { error: '최상위 도메인(TLD)이 올바르지 않습니다.' }
  }
  if (hostname.length > 253) return { error: '도메인이 너무 깁니다.' }
  return { domain: hostname }
}

// 등록 가능 도메인(apex) 추출 — co.kr 등 2단계 접미사 반영한 휴리스틱
export function registrableDomain(domain) {
  const labels = String(domain ?? '').split('.')
  if (labels.length < 2) return domain
  const lastTwo = labels.slice(-2).join('.')
  const parts = MULTI_PART_TLDS.has(lastTwo) ? 3 : 2
  return labels.slice(-parts).join('.')
}

// apex | www | subdomain 판별
export function classifyDomainType(domain) {
  const apex = registrableDomain(domain)
  if (domain === apex) return 'apex'
  if (domain === `www.${apex}`) return 'www'
  return 'subdomain'
}

// 같은 등록 도메인(사이트)인지 — www·서브도메인 차이는 무시
export function isSameRegistrableDomain(domainA, domainB) {
  if (!domainA || !domainB) return false
  return registrableDomain(String(domainA).toLowerCase()) === registrableDomain(String(domainB).toLowerCase())
}

// 기존 홈페이지 URL에서 호스트명 추출 (실패 시 '')
export function hostnameFromUrl(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// 운영방식·도메인 구조 적합성 경고 (저장은 허용하되 직원에게 안내)
// 반환: 경고 문자열 배열
export function checkModeCompatibility({ domain, domainType, operationMode, existingUrl }) {
  const warnings = []
  const existingHost = hostnameFromUrl(existingUrl)
  const sameSite = existingHost !== '' && isSameRegistrableDomain(domain, existingHost)

  if (operationMode === 'independent' && sameSite) {
    warnings.push('독립 SEO 사이트 모드인데 기존 공식 홈페이지와 같은 도메인입니다. 기존 사이트를 교체하려는 것이라면 운영방식을 "기존 홈페이지 교체"로 변경하세요.')
  }
  if (operationMode === 'subdomain' && (domainType === 'apex' || domainType === 'www')) {
    warnings.push('서브도메인 운영 모드인데 apex/www 도메인이 입력되었습니다. info.병원도메인 형태의 서브도메인을 입력하세요.')
  }
  if (operationMode === 'subdomain' && existingHost !== '' && !sameSite) {
    warnings.push('서브도메인 모드는 보통 기존 홈페이지와 같은 도메인의 하위 이름을 사용합니다. 입력한 도메인이 기존 홈페이지와 다른 도메인입니다.')
  }
  if (operationMode === 'replace' && existingHost !== '' && !sameSite) {
    warnings.push('기존 홈페이지 교체 모드인데 기존 홈페이지와 전혀 다른 도메인입니다. 교체 대상 도메인이 맞는지 확인이 필요합니다.')
  }
  if (operationMode === 'replace' && sameSite) {
    warnings.push('주의: 기존 홈페이지 도메인을 전환하면 기존 사이트 접속이 중단됩니다. DNS 변경 전 백업·롤백 계획(기존 레코드 기록)을 확인하고, 전환 승인 후 진행하세요.')
  }
  return warnings
}
