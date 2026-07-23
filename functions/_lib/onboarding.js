// ============================================================
// Client Onboarding — 검증·정규화·진행률 계산 (Phase 14A)
//
// 병원 계약 후 직원이 입력하는 온보딩 정보의 단일 기준 모듈입니다.
// - API(/api/onboarding, /api/sites)와 향후 Phase(14B Import, 14C Domain,
//   15 Deploy, 16 SEO Operation)가 모두 이 모듈의 상수·검증을 재사용합니다.
// - 저장은 D1(site_onboarding) — onboarding-repository.js 참고.
// ============================================================

// 운영방식 (기본값: 독립 SEO 홍보사이트)
export const OPERATION_MODES = {
  independent: '독립 SEO 홍보사이트',
  replace: '기존 홈페이지 교체',
  subdomain: '서브도메인 운영',
}
export const DEFAULT_OPERATION_MODE = 'independent'

// 도메인 상태 — Phase 14C Domain Wizard에서 requested/connected/verified 등으로 확장
export const DOMAIN_STATUSES = ['undecided', 'decided']

// 파이프라인 단계 — 전이는 Deploy Engine(Phase 15)의 서버 서비스에서만 수행
export const ONBOARDING_STAGES = ['onboarding', 'import', 'domain', 'deploy', 'operating', 'error', 'paused']
export const STAGE_LABELS = {
  onboarding: '온보딩',
  import: 'Import',
  domain: '도메인 연결',
  deploy: '배포 진행',
  operating: '운영 중',
  error: '오류 — 확인 필요',
  paused: '일시 중지',
}

// 작업 체크 항목 (순서 = 화면 표시 순서). 항목 추가 시 여기만 수정하면
// 검증·진행률·대시보드가 함께 따라옵니다.
export const CHECKLIST_ITEMS = [
  { key: 'logo', label: '로고' },
  { key: 'photos', label: '사진' },
  { key: 'reservation', label: '예약링크' },
  { key: 'map', label: '지도' },
  { key: 'phone', label: '전화' },
  { key: 'domain', label: '도메인' },
]
export const CHECKLIST_KEYS = CHECKLIST_ITEMS.map((item) => item.key)

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 도메인: 소문자 영숫자·하이픈 라벨을 점으로 연결 (예: brightclinic.co.kr)
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
const PHONE_PATTERN = /^[0-9+\-() ]{0,30}$/

function cleanText(value, max) {
  return String(value ?? '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, max)
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// URL 필드: 비어 있으면 통과, 값이 있으면 http/https만 허용
function urlField(errors, value, label) {
  const text = cleanText(value, 300)
  if (text !== '' && !isValidHttpUrl(text)) {
    errors.push(`${label}은(는) http:// 또는 https:// 주소여야 합니다.`)
  }
  return text
}

// 온보딩 입력 검증·정규화.
// 반환: { errors: [...] } 또는 { value: 정규화된 온보딩 객체 }
// hospitalName은 사이트 생성 시 사이트 이름과 동일한 값을 사용합니다.
export function validateOnboardingInput(input) {
  const errors = []
  const s = input && typeof input === 'object' ? input : {}

  const hospitalName = cleanText(s.hospitalName, 60)
  if (hospitalName === '') errors.push('병원명을 입력해 주세요.')
  if (/[<>]/.test(hospitalName)) errors.push('병원명에 < > 문자는 사용할 수 없습니다.')

  const managerName = cleanText(s.managerName, 30)
  const managerPhone = cleanText(s.managerPhone, 30)
  if (managerPhone !== '' && !PHONE_PATTERN.test(managerPhone)) {
    errors.push('담당자 연락처는 숫자·하이픈 형식이어야 합니다. (예: 010-1234-5678)')
  }
  const managerEmail = cleanText(s.managerEmail, 80)
  if (managerEmail !== '' && !EMAIL_PATTERN.test(managerEmail)) {
    errors.push('담당자 이메일 형식이 올바르지 않습니다.')
  }

  const operationMode = s.operationMode === undefined || s.operationMode === '' ? DEFAULT_OPERATION_MODE : String(s.operationMode)
  if (!Object.hasOwn(OPERATION_MODES, operationMode)) {
    errors.push(`운영방식은 다음 중 하나여야 합니다: ${Object.keys(OPERATION_MODES).join(', ')}`)
  }

  const existingUrl = urlField(errors, s.existingUrl, '기존 홈페이지 URL')
  const reservationUrl = urlField(errors, s.reservationUrl, '예약 URL')
  const naverMapUrl = urlField(errors, s.naverMapUrl, '네이버지도 URL')
  const kakaoChannelUrl = urlField(errors, s.kakaoChannelUrl, '카카오채널 URL')

  const phone = cleanText(s.phone, 30)
  if (phone !== '' && !PHONE_PATTERN.test(phone)) {
    errors.push('전화번호는 숫자·하이픈 형식이어야 합니다. (예: 062-123-4567)')
  }

  // 새 도메인: 미정(undecided) 또는 입력(decided). 입력 시 형식 검증.
  const newDomain = cleanText(s.newDomain, 100).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const domainStatus = newDomain !== '' ? 'decided' : 'undecided'
  if (newDomain !== '' && !DOMAIN_PATTERN.test(newDomain)) {
    errors.push('새 도메인 형식이 올바르지 않습니다. (예: brightclinic.co.kr — 미정이면 비워두세요)')
  }

  // 작업 체크: 알려진 키만 저장 (알 수 없는 키는 무시)
  const rawChecklist = s.checklist && typeof s.checklist === 'object' ? s.checklist : {}
  const checklist = {}
  for (const key of CHECKLIST_KEYS) checklist[key] = rawChecklist[key] === true

  if (errors.length > 0) return { errors }
  return {
    value: {
      hospitalName,
      managerName,
      managerPhone,
      managerEmail,
      operationMode,
      existingUrl,
      reservationUrl,
      phone,
      naverMapUrl,
      kakaoChannelUrl,
      newDomain,
      domainStatus,
      checklist,
    },
  }
}

// 진행률: 작업 체크 완료 수 / 전체 항목 수 (반올림 %)
export function computeProgress(checklist) {
  const list = checklist && typeof checklist === 'object' ? checklist : {}
  const done = CHECKLIST_KEYS.filter((key) => list[key] === true).length
  const total = CHECKLIST_KEYS.length
  return { done, total, percent: Math.round((done / total) * 100) }
}
