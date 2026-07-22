// ============================================================
// Import Apply — 검토·승인된 항목만 hospital.json에 병합 (Phase 14B)
//
// 원칙:
//  - 사용자가 selections에 명시적으로 담아 보낸 필드만 변경 (자동 덮어쓰기 없음)
//  - 그 외 모든 기존 필드는 그대로 보존 (deep copy 후 선택 필드만 수정)
//  - 의료진 적용은 Phase 13 Entity 구조(doctors[])에 "추가"하며,
//    validateEntities로 정합성을 보장 (기존 항목 덮어쓰지 않음)
//  - 검증 실패 시 아무것도 적용하지 않고 오류 목록 반환
//  - 담당자 연락처 등 내부 온보딩 정보는 여기서 다루지 않음 (공개 파일 금지)
// ============================================================

import { validateEntities } from './entities.js'

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function clean(value, max) {
  return String(value ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max)
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// 적용 가능한 스칼라 필드 정의: [selectionKey, 라벨, 최대 길이, hospital.json 반영 함수]
const SCALAR_FIELDS = [
  ['name', '병원명', 60, (h, v) => { h.name = v }],
  ['description', '병원 소개', 300, (h, v) => { h.description = v }],
  ['phone', '전화번호', 30, (h, v) => { h.phone = v }],
  ['address', '주소', 120, (h, v) => { h.address = v }],
  ['hoursWeekday', '평일 진료시간', 60, (h, v) => { h.hours = { ...(h.hours ?? {}) }; h.hours.weekday = v }],
  ['hoursSaturday', '토요일 진료시간', 60, (h, v) => { h.hours = { ...(h.hours ?? {}) }; h.hours.saturday = v }],
  ['hoursSunday', '일·공휴일 진료시간', 60, (h, v) => { h.hours = { ...(h.hours ?? {}) }; h.hours.sundayHoliday = v; delete h.hours.sunday }],
]
const URL_FIELDS = [
  ['reservationUrl', '예약 URL', (h, v) => { h.channels = { ...(h.channels ?? {}) }; h.channels.naverBooking = v }],
  ['naverMapUrl', '네이버지도 URL', (h, v) => { h.channels = { ...(h.channels ?? {}) }; h.channels.naverMap = v }],
  ['kakaoUrl', '카카오채널 URL', (h, v) => { h.channels = { ...(h.channels ?? {}) }; h.channels.kakao = v }],
  ['logoImage', '로고 이미지', (h, v) => { h.images = { ...(h.images ?? {}) }; h.images.logo = v }],
  ['heroImage', '대표 이미지', (h, v) => { h.images = { ...(h.images ?? {}) }; h.images.hero = v }],
]

export const APPLYABLE_FIELDS = [
  ...SCALAR_FIELDS.map(([key]) => key),
  ...URL_FIELDS.map(([key]) => key),
  'faq',
  'doctors',
]

// 다음 doctor-N 슬러그 (기존 엔티티와 충돌하지 않는 번호부터)
function nextDoctorSlug(existing, used) {
  let n = 1
  while (existing.some((doctor) => doctor.id === `doctor-${n}`) || used.has(`doctor-${n}`)) n += 1
  used.add(`doctor-${n}`)
  return `doctor-${n}`
}

// selections(검토 화면에서 선택·수정한 값)를 hospital에 병합.
// 반환: { errors } 또는 { hospital: 병합본, appliedFields: [적용된 selectionKey] }
export function applyImportSelections(hospital, selections) {
  const errors = []
  const s = selections && typeof selections === 'object' ? selections : {}
  const next = JSON.parse(JSON.stringify(hospital))
  const appliedFields = []

  for (const [key, label, max, assign] of SCALAR_FIELDS) {
    if (s[key] === undefined) continue
    const value = clean(s[key], max + 1)
    if (value === '') { errors.push(`${label} 값이 비어 있습니다.`); continue }
    if (value.length > max) { errors.push(`${label}은(는) ${max}자 이내여야 합니다.`); continue }
    if (/[<>]/.test(value)) { errors.push(`${label}에 < > 문자는 사용할 수 없습니다.`); continue }
    assign(next, value)
    appliedFields.push(key)
  }

  for (const [key, label, assign] of URL_FIELDS) {
    if (s[key] === undefined) continue
    const value = clean(s[key], 300)
    if (!isValidHttpUrl(value)) { errors.push(`${label}은(는) http/https 주소여야 합니다.`); continue }
    assign(next, value)
    appliedFields.push(key)
  }

  // FAQ: 선택 시 교체 (1~10개, 사이트 설정과 동일한 길이 규칙)
  if (s.faq !== undefined) {
    const faq = Array.isArray(s.faq) ? s.faq : []
    if (faq.length < 1 || faq.length > 10) {
      errors.push('FAQ는 1~10개여야 합니다.')
    } else {
      const cleaned = []
      for (const [index, item] of faq.entries()) {
        const question = clean(item?.question, 121)
        const answer = clean(item?.answer, 301)
        if (question === '' || question.length > 120) errors.push(`FAQ ${index + 1} 질문은 1~120자여야 합니다.`)
        else if (answer === '' || answer.length > 300) errors.push(`FAQ ${index + 1} 답변은 1~300자여야 합니다.`)
        else cleaned.push({ question, answer })
      }
      if (cleaned.length === faq.length) {
        next.faq = cleaned
        appliedFields.push('faq')
      }
    }
  }

  // 의료진: Entity(doctors[])에 추가 — 이름·직책·사진만 (약력 등은 운영자가 엔티티 탭에서 입력)
  if (s.doctors !== undefined) {
    const doctors = Array.isArray(s.doctors) ? s.doctors : []
    if (doctors.length < 1 || doctors.length > 10) {
      errors.push('적용할 의료진은 1~10명이어야 합니다.')
    } else {
      const existing = Array.isArray(next.doctors) ? next.doctors : []
      const used = new Set()
      const additions = []
      for (const [index, doctor] of doctors.entries()) {
        const name = clean(doctor?.name, 21)
        const title = clean(doctor?.title, 30)
        const image = clean(doctor?.image, 300)
        if (!/^[가-힣a-zA-Z .]{2,20}$/.test(name)) { errors.push(`의료진 ${index + 1}의 이름이 올바르지 않습니다.`); continue }
        if (image !== '' && !isValidHttpUrl(image)) { errors.push(`의료진 ${index + 1}의 사진 URL이 올바르지 않습니다.`); continue }
        if (existing.some((d) => d.name === name) || additions.some((d) => d.name === name)) {
          errors.push(`의료진 "${name}"은(는) 이미 등록되어 있습니다.`)
          continue
        }
        additions.push({
          id: nextDoctorSlug(existing, used),
          name,
          title: title || '원장',
          departmentIds: [],
          specialties: [],
          bio: '',
          career: [],
          education: [],
          certifications: [],
          image,
          imageAlt: image !== '' ? `${name} ${title || '원장'} 사진` : '',
          consultationUrl: '',
          seo: { title: '', description: '', keywords: [] },
        })
      }
      if (errors.length === 0 && additions.length > 0) {
        const validated = validateEntities({
          departments: Array.isArray(next.departments) ? next.departments : [],
          doctors: [...existing, ...additions],
        })
        if (validated.errors) {
          errors.push(...validated.errors.slice(0, 3))
        } else {
          next.departments = validated.departments
          next.doctors = validated.doctors
          appliedFields.push('doctors')
        }
      }
    }
  }

  if (errors.length > 0) return { errors }
  if (appliedFields.length === 0) return { errors: ['적용할 항목이 선택되지 않았습니다.'] }
  return { hospital: next, appliedFields }
}
