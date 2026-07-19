// 사이트 도메인(URL) 검증·정규화
//
// 도메인 값의 단일 원천은 sites/<사이트ID>/hospital.json 의 site.url 입니다.
// 이 함수는 그 값이 올바른지 검사하고, 끝의 슬래시를 제거해
// 사이트 전체(canonical, OG, JSON-LD, sitemap, robots.txt)가
// 항상 같은 형태의 URL을 쓰도록 통일합니다.
//
// 값이 없거나 잘못된 경우 다른 도메인으로 조용히 대체하지 않고
// 빌드를 즉시 실패시킵니다. (잘못된 도메인으로 배포되는 사고 방지)

export function normalizeSiteUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      '[사이트 설정 오류] hospital.json에 site.url이 없습니다. 예: "site": { "url": "https://example.com" }'
    )
  }

  let parsed
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error(
      `[사이트 설정 오류] hospital.json의 site.url("${rawUrl}")이 올바른 URL이 아닙니다. https://로 시작하는 절대 주소여야 합니다.`
    )
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `[사이트 설정 오류] hospital.json의 site.url("${rawUrl}")은 http:// 또는 https:// 로 시작해야 합니다.`
    )
  }

  // 끝의 슬래시 제거 → "https://example.com" 형태로 통일
  return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}
