// ============================================================
// 엔티티(진료과·의료진) 구조화 데이터 생성 (Phase 13)
//
// 원칙:
// - 실제 데이터가 있는 필드만 출력 (빈 문자열·빈 배열은 생략)
// - 절대 URL만 사용 (siteUrl 기준)
// - schema 내용은 페이지 본문과 일치 — 허위 정보 생성 없음
// - 기존 Schema Engine(generate-schema.js)·FAQ 스키마와 별개 객체로
//   BaseLayout의 jsonLd prop을 통해 페이지별로 추가 출력됩니다.
// ============================================================

import { isReal, isValidHttpUrl } from '../schema.js'

const abs = (siteUrl, path) => `${siteUrl}${path}`

// BreadcrumbList — items: [{ name, path }]
export function buildBreadcrumbSchema(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: abs(siteUrl, item.path),
    })),
  }
}

// ItemList — items: [{ name, path, image? }]
export function buildItemListSchema(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => {
      const element = {
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        url: abs(siteUrl, item.path),
      }
      if (isValidHttpUrl(item.image)) element.image = item.image.trim()
      return element
    }),
  }
}

// Person — 의료진 상세 (실데이터 필드만)
export function buildPersonSchema(doctor, hospital, siteUrl) {
  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: doctor.name,
    url: abs(siteUrl, `/doctors/${doctor.id}/`),
    worksFor: {
      '@type': 'MedicalOrganization',
      name: hospital.name,
      url: siteUrl,
    },
  }
  if (isReal(doctor.title)) person.jobTitle = doctor.title
  if (isValidHttpUrl(doctor.image)) person.image = doctor.image.trim()
  if (Array.isArray(doctor.specialties) && doctor.specialties.length > 0) {
    person.knowsAbout = doctor.specialties
  }
  return person
}

// 진료과 상세 — 의료기관 하위 조직 (실데이터 필드만)
export function buildDepartmentSchema(department, hospital, siteUrl) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: `${hospital.name} ${department.name}`,
    url: abs(siteUrl, `/departments/${department.id}/`),
    parentOrganization: {
      '@type': 'MedicalOrganization',
      name: hospital.name,
      url: siteUrl,
    },
  }
  if (isReal(department.shortDescription) || isReal(department.description)) {
    schema.description = isReal(department.shortDescription) ? department.shortDescription : department.description
  }
  if (isValidHttpUrl(department.image)) schema.image = department.image.trim()
  if (isReal(department.phone)) schema.telephone = department.phone
  return schema
}

// 페이지에서 쓰는 안전한 엔티티 접근자 (배열이 아니면 빈 배열)
export function entityArrays(hospital) {
  return {
    departments: Array.isArray(hospital.departments) ? hospital.departments.filter((d) => d && d.id && d.name) : [],
    doctors: Array.isArray(hospital.doctors) ? hospital.doctors.filter((d) => d && d.id && d.name) : [],
  }
}
