// ============================================================
// Import Score — 추출 완성도 점수 (Phase 14B)
//
// 순수 함수. 가중치·라벨은 이 파일 한 곳에서만 관리합니다.
// "발견 개수"가 아니라 운영 중요도 가중치 합산 방식입니다.
// ============================================================

// [fieldKeys, label, weight, 중요(core) 여부]
// fieldKeys가 여러 개인 항목(진료시간)은 하나라도 발견되면 부분 점수,
// 전부 발견되면 만점을 줍니다.
export const SCORE_FIELDS = [
  { key: 'name', label: '병원명', fields: ['name'], weight: 12, core: true },
  { key: 'phone', label: '전화번호', fields: ['phone'], weight: 12, core: true },
  { key: 'address', label: '주소', fields: ['address'], weight: 12, core: true },
  { key: 'hours', label: '진료시간', fields: ['hoursWeekday', 'hoursSaturday', 'hoursSunday'], weight: 12, core: true },
  { key: 'services', label: '진료과목', fields: ['services'], weight: 12, core: true },
  { key: 'doctors', label: '의료진', fields: ['doctors'], weight: 12, core: true },
  { key: 'reservationUrl', label: '예약 URL', fields: ['reservationUrl'], weight: 5, core: false },
  { key: 'naverMapUrl', label: '지도', fields: ['naverMapUrl'], weight: 4, core: false },
  { key: 'description', label: '병원 소개', fields: ['description'], weight: 5, core: false },
  { key: 'doctorImages', label: '의료진 사진', fields: [], weight: 3, core: false }, // doctors 후보의 image 존재 여부로 판단
  { key: 'facilityImages', label: '시설 사진', fields: ['facilityImages'], weight: 3, core: false },
  { key: 'faq', label: 'FAQ', fields: ['faq'], weight: 4, core: false },
  { key: 'logoImage', label: '로고', fields: ['logoImage'], weight: 4, core: false },
]
// 가중치 합 = 100

function countLabel(fieldKey, candidate) {
  if (!candidate) return ''
  if (fieldKey === 'doctors') return `${candidate.value.length}명 발견`
  if (fieldKey === 'facilityImages') return `${candidate.value.length}장 발견`
  if (Array.isArray(candidate.value)) return `${candidate.value.length}건 발견`
  return '발견'
}

// candidates → { percent, breakdown, missing }
// breakdown: [{ key, label, weight, found, ratio, detail }]
// missing: 직원이 병원에 추가로 요청할 자료 목록 (누락 항목만 — 추측 없음)
export function computeImportScore(candidates) {
  const byField = new Map()
  for (const candidate of candidates ?? []) byField.set(candidate.fieldKey, candidate)

  let earned = 0
  let total = 0
  const breakdown = []
  for (const item of SCORE_FIELDS) {
    total += item.weight
    let ratio = 0
    let detail = '누락'
    if (item.key === 'doctorImages') {
      const doctors = byField.get('doctors')?.value ?? []
      const withImage = doctors.filter((doctor) => doctor.image !== '').length
      ratio = doctors.length > 0 && withImage > 0 ? 1 : 0
      detail = ratio > 0 ? `${withImage}명 사진 발견` : '누락'
    } else {
      const found = item.fields.filter((fieldKey) => byField.has(fieldKey))
      ratio = item.fields.length === 0 ? 0 : found.length / item.fields.length
      if (ratio > 0) {
        detail = item.fields.length > 1
          ? `${found.length}/${item.fields.length} 발견`
          : countLabel(item.fields[0], byField.get(item.fields[0]))
      }
    }
    earned += item.weight * ratio
    breakdown.push({ key: item.key, label: item.label, weight: item.weight, core: item.core, found: ratio > 0, ratio, detail })
  }

  const missing = breakdown.filter((item) => item.ratio < 1).map((item) => item.label)
  return { percent: Math.round((earned / total) * 100), breakdown, missing }
}
