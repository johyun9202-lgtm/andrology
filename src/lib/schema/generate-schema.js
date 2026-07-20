// ============================================================
// Schema Engine v1 — 사이트 기본 구조화 데이터(JSON-LD) 생성
//
// 사이트 데이터(hospital.json)의 schema.type 값만으로
// 사이트 대표 JSON-LD의 @type이 결정됩니다. 코드 수정이 필요 없습니다.
//
//   "schema": { "type": "SoftwareApplication" }
//
// 지원 타입: MedicalClinic, Organization, SoftwareApplication,
//           LocalBusiness, Person
// schema.type이 없으면 기존과 동일하게 MedicalClinic을 사용합니다(하위 호환).
// 지원하지 않는 타입이면 잘못된 스키마가 배포되지 않도록 빌드를 실패시킵니다.
//
// 아티클 FAQ(FAQPage) 스키마는 기존대로 src/lib/schema.js가 담당합니다.
// ============================================================

import { isReal } from '../schema.js'

export const SUPPORTED_SCHEMA_TYPES = [
  'MedicalClinic',
  'Organization',
  'SoftwareApplication',
  'LocalBusiness',
  'Person',
]

export const DEFAULT_SCHEMA_TYPE = 'MedicalClinic'

// 타입별 포함 필드 정책 (schema.org 속성 정의 기준)
// - openingHours: 영업 장소 타입에만 존재 (LocalBusiness 계열)
// - telephone/address: SoftwareApplication에는 해당 속성이 없음
const HAS_OPENING_HOURS = new Set(['MedicalClinic', 'LocalBusiness'])
const HAS_CONTACT_FIELDS = new Set(['MedicalClinic', 'LocalBusiness', 'Organization', 'Person'])

// schema.type 값을 검증해 확정합니다. (없으면 기본값, 잘못되면 빌드 중단)
export function resolveSchemaType(hospital) {
  const raw = hospital?.schema?.type
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return DEFAULT_SCHEMA_TYPE
  }
  const type = String(raw).trim()
  if (!SUPPORTED_SCHEMA_TYPES.includes(type)) {
    throw new Error(
      `[스키마 설정 오류] schema.type "${type}"은 지원하지 않는 타입입니다. ` +
        `사용 가능: ${SUPPORTED_SCHEMA_TYPES.join(', ')}`
    )
  }
  return type
}

// 사이트 대표 JSON-LD 객체를 생성합니다.
export function generateSiteSchema(hospital, siteUrl) {
  const type = resolveSchemaType(hospital)

  const schema = {
    '@context': 'https://schema.org',
    '@type': type,
    name: hospital.name,
    description: hospital.description,
    url: siteUrl,
  }

  if (HAS_CONTACT_FIELDS.has(type)) {
    if (isReal(hospital.phone)) {
      schema.telephone = hospital.phone
    }
    if (isReal(hospital.address)) {
      schema.address = hospital.address
    }
  }

  if (HAS_OPENING_HOURS.has(type)) {
    const hoursLabels = {
      weekday: '평일',
      saturday: '토요일',
      sundayHoliday: '일요일·공휴일',
    }
    const hours = Object.entries(hospital.hours ?? {})
      .filter(([, value]) => isReal(value))
      .map(([key, value]) => `${hoursLabels[key] ?? key} ${value}`)
    if (hours.length > 0) {
      schema.openingHours = hours
    }
  }

  return schema
}
