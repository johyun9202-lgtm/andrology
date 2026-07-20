// 사이트 식별자(SITE) 결정·검증
//
// 어떤 업체 사이트를 빌드할지는 SITE 환경변수로 정합니다.
//   예: SITE=aiseolab  →  sites/aiseolab/hospital.json 사용
// 환경변수가 없으면 기본값 'aiseolab'를 사용하므로
// Cloudflare Pages에 아무 설정을 하지 않아도 기존 사이트가 그대로 배포됩니다.
//
// 이 파일은 빌드 시점(Node 환경)에서만 실행됩니다.
// 브라우저로 전달되는 코드가 아니므로 process.env 접근이 안전하며,
// 혹시 모를 다른 환경을 위해 typeof 가드를 두었습니다.

export const DEFAULT_SITE = 'aiseolab'

// 영문 소문자·숫자·하이픈만 허용 (예: dental-example)
// 경로 조작(../, 슬래시, 공백 등)은 형식 검사에서 전부 차단됩니다.
const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function resolveSiteId(rawValue) {
  // 값이 없으면 기본 사이트
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return DEFAULT_SITE
  }

  const siteId = String(rawValue).trim()

  if (siteId.length > 50 || !SITE_ID_PATTERN.test(siteId)) {
    throw new Error(
      `[SITE 오류] 사이트 ID "${siteId}"가 잘못되었습니다. ` +
        '영문 소문자·숫자·하이픈만 사용할 수 있습니다. (예: SITE=andrology)'
    )
  }

  return siteId
}

export function getSiteId() {
  const raw =
    typeof process !== 'undefined' && process.env ? process.env.SITE : undefined
  return resolveSiteId(raw)
}
