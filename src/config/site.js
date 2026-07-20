// 사이트 인프라 설정
//
// 도메인 값은 hospital.json(site.url)이 단일 원천이며,
// 여기서는 검증·정규화를 거친 값을 파생해 내보내기만 합니다.
// (같은 값을 두 곳에 저장하지 않습니다)

import { siteData } from '../lib/site-data.js'
import { normalizeSiteUrl } from '../lib/site-url.js'

export const site = {
  siteUrl: normalizeSiteUrl(siteData.site?.url),
}

// 헤더 메뉴 — 사이트 데이터에 nav 배열이 있으면 그 값을, 없으면 기본 메뉴를 사용합니다.
export const nav =
  Array.isArray(siteData.nav) && siteData.nav.length > 0
    ? siteData.nav
    : [
        { href: '/', label: '홈' },
        { href: '/services', label: '진료안내' },
        { href: '/faq', label: 'FAQ' },
        { href: '/articles', label: '아티클' },
        { href: '/contact', label: '상담문의' },
      ]
