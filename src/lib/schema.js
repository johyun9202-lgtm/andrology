// 구조화 데이터(JSON-LD) 생성 유틸리티
// hospital.json 값을 기반으로 자동 생성하며,
// "미정"이거나 비어 있는 값은 출력하지 않습니다.

// 실제 정보가 아닌 값(미정, 빈 문자열 등)인지 판별
export function isReal(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '미정'
}

// 병원 기본 정보 (MedicalClinic)
export function buildClinicSchema(hospital, siteUrl) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: hospital.name,
    description: hospital.description,
    url: siteUrl,
  }

  if (isReal(hospital.phone)) {
    schema.telephone = hospital.phone
  }

  if (isReal(hospital.address)) {
    schema.address = hospital.address
  }

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

  return schema
}

// 자주 묻는 질문 (FAQPage)
export function buildFaqSchema(faqItems) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
