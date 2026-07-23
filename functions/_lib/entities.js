// ============================================================
// Doctor & Department Entity — 검증·정규화 모듈 (Phase 13)
//
// 순수 함수로만 구성 — Workers·Node 어디서나 테스트 가능.
// validateEntities({ departments, doctors }) →
//   { errors } 또는 { departments, doctors } (정규화 완료본)
//
// 규칙:
// - id는 영문 slug (^[a-z0-9]+(-[a-z0-9]+)*$, 2~40자), 중복 금지
// - 관계는 ID로 연결: doctor.departmentIds ↔ department.doctorIds
//   양쪽 어디에 적어도 "합집합"으로 인정한 뒤 양방향을 동기화 (불일치 방지)
// - 존재하지 않는 ID 참조는 오류, 중복 연결은 제거
// - 실제 입력된 정보만 저장 — 경력·자격 등은 입력 그대로 (임의 생성 없음)
// - URL·이미지는 http/https만 (javascript:/data:/file: 차단)
// ============================================================

import { isValidHttpUrl } from '../../src/lib/schema.js'

export const ENTITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const LIMITS = {
  departments: 30,
  doctors: 50,
  name: 40,
  title: 40,
  shortDescription: 120,
  longText: 2000,
  listItem: 120,
  listItems: 20,
  specialties: 15,
  specialty: 40,
  phone: 30,
  imageAlt: 120,
  seoTitle: 70,
  seoDescription: 200,
  keywords: 10,
  keyword: 30,
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const clean = (v) => String(v ?? '').replace(CONTROL_CHARS, '').trim()

function text(errors, value, label, { max, required = false } = {}) {
  const cleaned = clean(value)
  if (required && cleaned === '') errors.push(`${label}은(는) 비워둘 수 없습니다.`)
  if (max && cleaned.length > max) errors.push(`${label}은(는) ${max}자 이내여야 합니다.`)
  if (/<script|javascript:|onerror=|onclick=|<iframe/i.test(cleaned)) errors.push(`${label}에 허용되지 않는 스크립트 패턴이 있습니다.`)
  return cleaned
}

function url(errors, value, label) {
  const cleaned = clean(value)
  if (cleaned === '') return ''
  if (!isValidHttpUrl(cleaned)) {
    errors.push(`${label}은(는) http:// 또는 https:// 주소여야 합니다.`)
    return ''
  }
  return cleaned
}

function stringList(errors, value, label, { maxItems, maxLength }) {
  const list = Array.isArray(value) ? value : []
  if (list.length > maxItems) errors.push(`${label}은(는) 최대 ${maxItems}개까지 입력할 수 있습니다.`)
  return list.slice(0, maxItems).map((item) => text(errors, item, label, { max: maxLength })).filter((item) => item !== '')
}

function seoBlock(errors, value, label) {
  const src = value && typeof value === 'object' ? value : {}
  const seo = {
    title: text(errors, src.title, `${label} SEO 제목`, { max: LIMITS.seoTitle }),
    description: text(errors, src.description, `${label} SEO 설명`, { max: LIMITS.seoDescription }),
    keywords: stringList(errors, src.keywords, `${label} SEO 키워드`, { maxItems: LIMITS.keywords, maxLength: LIMITS.keyword }),
  }
  return seo
}

function slugId(errors, value, label) {
  const id = clean(value)
  if (!ENTITY_SLUG_PATTERN.test(id) || id.length < 2 || id.length > 40) {
    errors.push(`${label}의 id(slug)는 영문 소문자·숫자·하이픈 2~40자여야 합니다. (현재: "${id}")`)
  }
  return id
}

// ---------- 메인 검증·정규화 ----------
export function validateEntities({ departments, doctors } = {}) {
  const errors = []
  const rawDepartments = Array.isArray(departments) ? departments : []
  const rawDoctors = Array.isArray(doctors) ? doctors : []
  if (rawDepartments.length > LIMITS.departments) errors.push(`진료과는 최대 ${LIMITS.departments}개까지 등록할 수 있습니다.`)
  if (rawDoctors.length > LIMITS.doctors) errors.push(`의료진은 최대 ${LIMITS.doctors}명까지 등록할 수 있습니다.`)

  const outDepartments = rawDepartments.slice(0, LIMITS.departments).map((src, index) => {
    const label = `진료과 ${index + 1}`
    const item = src && typeof src === 'object' ? src : {}
    return {
      id: slugId(errors, item.id, label),
      name: text(errors, item.name, `${label} 이름`, { max: LIMITS.name, required: true }),
      shortDescription: text(errors, item.shortDescription, `${label} 짧은 설명`, { max: LIMITS.shortDescription }),
      description: text(errors, item.description, `${label} 상세 설명`, { max: LIMITS.longText }),
      image: url(errors, item.image, `${label} 이미지 URL`),
      phone: text(errors, item.phone, `${label} 전화번호`, { max: LIMITS.phone }),
      consultationUrl: url(errors, item.consultationUrl, `${label} 상담 URL`),
      doctorIds: Array.isArray(item.doctorIds) ? item.doctorIds.map((v) => clean(v)) : [],
      seo: seoBlock(errors, item.seo, label),
    }
  })

  const outDoctors = rawDoctors.slice(0, LIMITS.doctors).map((src, index) => {
    const label = `의료진 ${index + 1}`
    const item = src && typeof src === 'object' ? src : {}
    return {
      id: slugId(errors, item.id, label),
      name: text(errors, item.name, `${label} 이름`, { max: LIMITS.name, required: true }),
      title: text(errors, item.title, `${label} 직책`, { max: LIMITS.title }),
      departmentIds: Array.isArray(item.departmentIds) ? item.departmentIds.map((v) => clean(v)) : [],
      specialties: stringList(errors, item.specialties, `${label} 전문 분야`, { maxItems: LIMITS.specialties, maxLength: LIMITS.specialty }),
      bio: text(errors, item.bio, `${label} 소개`, { max: LIMITS.longText }),
      career: stringList(errors, item.career, `${label} 경력`, { maxItems: LIMITS.listItems, maxLength: LIMITS.listItem }),
      education: stringList(errors, item.education, `${label} 학력`, { maxItems: LIMITS.listItems, maxLength: LIMITS.listItem }),
      certifications: stringList(errors, item.certifications, `${label} 자격`, { maxItems: LIMITS.listItems, maxLength: LIMITS.listItem }),
      image: url(errors, item.image, `${label} 사진 URL`),
      imageAlt: text(errors, item.imageAlt, `${label} 이미지 설명(alt)`, { max: LIMITS.imageAlt }),
      consultationUrl: url(errors, item.consultationUrl, `${label} 상담 URL`),
      seo: seoBlock(errors, item.seo, label),
    }
  })

  // ---------- id 중복 검사 ----------
  const seenDept = new Set()
  for (const dept of outDepartments) {
    if (dept.id && seenDept.has(dept.id)) errors.push(`진료과 slug가 중복되었습니다: "${dept.id}"`)
    seenDept.add(dept.id)
  }
  const seenDoc = new Set()
  for (const doc of outDoctors) {
    if (doc.id && seenDoc.has(doc.id)) errors.push(`의료진 slug가 중복되었습니다: "${doc.id}"`)
    seenDoc.add(doc.id)
  }

  // ---------- 관계 검증 + 양방향 정규화 ----------
  const deptIds = new Set(outDepartments.map((d) => d.id))
  const docIds = new Set(outDoctors.map((d) => d.id))
  for (const dept of outDepartments) {
    for (const ref of dept.doctorIds) {
      if (!docIds.has(ref)) errors.push(`진료과 "${dept.id}"가 존재하지 않는 의료진 id를 참조합니다: "${ref}"`)
    }
  }
  for (const doc of outDoctors) {
    for (const ref of doc.departmentIds) {
      if (!deptIds.has(ref)) errors.push(`의료진 "${doc.id}"가 존재하지 않는 진료과 id를 참조합니다: "${ref}"`)
    }
  }

  if (errors.length > 0) return { errors }

  // 합집합 기반 양방향 동기화 (어느 한쪽에만 적어도 서로 연결, 중복 제거)
  const edges = new Set()
  for (const dept of outDepartments) for (const ref of dept.doctorIds) edges.add(`${dept.id}::${ref}`)
  for (const doc of outDoctors) for (const ref of doc.departmentIds) edges.add(`${ref}::${doc.id}`)
  for (const dept of outDepartments) {
    dept.doctorIds = outDoctors.map((d) => d.id).filter((docId) => edges.has(`${dept.id}::${docId}`))
  }
  for (const doc of outDoctors) {
    doc.departmentIds = outDepartments.map((d) => d.id).filter((deptId) => edges.has(`${deptId}::${doc.id}`))
  }

  return { departments: outDepartments, doctors: outDoctors }
}
