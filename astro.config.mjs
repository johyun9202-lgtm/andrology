// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { siteData } from './src/lib/site-data.js'
import { normalizeSiteUrl } from './src/lib/site-url.js'
import { getSiteId, COMPANY_SITE } from './src/lib/site-id.js'

// AI SEO Lab 회사 홈페이지(aiseolab)는 외부에 파는 SaaS가 아니라 내부 도구이므로,
// /services·/articles·/faq·/contact처럼 nav에서 이미 뺀 범용 템플릿 페이지는
// 회사 사이트 빌드에서만 사이트맵에서도 제외합니다. (병원 사이트는 이 페이지들이
// 실제 서비스 소개이므로 영향 없음 — noindex 메타 태그는 src/pages/*.astro 각각 참고)
const isCompanySite = getSiteId() === COMPANY_SITE

export default defineConfig({
  // 도메인 단일 원천: sites/<SITE>/hospital.json 의 site.url (SITE 미지정 시 andrology)
  site: normalizeSiteUrl(siteData.site?.url),
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      // 관리자용 페이지·병원 미리보기(/sites/)는 사이트맵에서 제외 (검색 노출 대상 아님)
      filter: (page) => {
        if (page.includes('/dashboard') || page.includes('/login') || page.includes('/sites/')) return false
        if (
          isCompanySite &&
          (page.includes('/services') || page.includes('/faq') || page.includes('/contact') || page.includes('/articles'))
        ) {
          return false
        }
        return true
      },
    }),
  ],
  build: {
    // 각 URL이 독립적인 HTML 파일로 생성됩니다. 예: /services → /services/index.html
    format: 'directory',
  },
})
