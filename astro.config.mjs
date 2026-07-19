// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import { siteData } from './src/lib/site-data.js'
import { normalizeSiteUrl } from './src/lib/site-url.js'

export default defineConfig({
  // 도메인 단일 원천: src/data/hospital.json 의 site.url
  site: normalizeSiteUrl(siteData.site?.url),
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: {
    // 각 URL이 독립적인 HTML 파일로 생성됩니다. 예: /services → /services/index.html
    format: 'directory',
  },
})
