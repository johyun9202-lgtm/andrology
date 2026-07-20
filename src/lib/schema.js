// 구조화 데이터(JSON-LD) 생성 유틸리티
// hospital.json 값을 기반으로 자동 생성하며,
// "미정"이거나 비어 있는 값은 출력하지 않습니다.

// 실제 정보가 아닌 값(미정, 빈 문자열 등)인지 판별
export function isReal(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '미정'
}

// 안전한 색상값인지 검증 (#RGB 또는 #RRGGBB 형식만 허용)
// 검증을 통과한 값만 CSS에 사용하므로 임의 문자열이 스타일에 삽입될 수 없습니다.
export function isValidColor(value) {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

// 안전한 외부 링크인지 검증 (http:// 또는 https:// 만 허용)
// javascript: 등 위험한 스킴은 여기서 전부 차단됩니다.
export function isValidHttpUrl(value) {
  if (!isReal(value)) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// 상담 채널 목록 생성 — 값이 유효한 채널만 반환합니다.
// 전화번호는 hospital.phone 한 곳에서 관리하는 것이 원칙이며,
// channels.phone은 "상담용 번호를 따로 쓸 때"만 채우는 선택 항목입니다.
// (channels.phone이 있으면 그 값을, 없으면 hospital.phone을 사용)
// 반환 형식은 [{ type, label, href, external }] 로,
// 향후 모바일 하단 고정 상담바에서도 그대로 재사용할 수 있습니다.
export function buildChannels(hospital) {
  const channels = hospital.channels ?? {}
  const result = []

  const phone = isReal(channels.phone) ? channels.phone : hospital.phone
  if (isReal(phone)) {
    result.push({
      type: 'phone',
      label: '전화 상담',
      href: `tel:${phone.trim().replace(/\s+/g, '')}`,
      external: false,
    })
  }

  if (isValidHttpUrl(channels.kakao)) {
    result.push({
      type: 'kakao',
      label: '카카오톡 상담',
      href: channels.kakao.trim(),
      external: true,
    })
  }

  if (isValidHttpUrl(channels.naverBooking)) {
    result.push({
      type: 'naver',
      label: '네이버 예약',
      href: channels.naverBooking.trim(),
      external: true,
    })
  }

  return result
}

// 사이트 대표 구조화 데이터는 Schema Engine으로 이동했습니다.
// → src/lib/schema/generate-schema.js (schema.type 기반 타입 선택)

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
