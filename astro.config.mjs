// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { siteData } from './src/lib/site-data.js'
import { normalizeSiteUrl } from './src/lib/site-url.js'

export default defineConfig({
  // 도메인 단일 원천: sites/<SITE>/hospital.json 의 site.url (SITE 미지정 시 andrology)
  site: normalizeSiteUrl(siteData.site?.url),
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      // 관리자용 페이지는 사이트맵에서 제외 (검색 노출 대상 아님)
      filter: (page) => !page.includes('/dashboard') && !page.includes('/login'),
    }),
  ],
  build: {
    // 각 URL이 독립적인 HTML 파일로 생성됩니다. 예: /services → /services/index.html
    format: 'directory',
  },
})
