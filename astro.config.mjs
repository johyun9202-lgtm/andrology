// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://andrology.co.kr',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: {
    // 각 URL이 독립적인 HTML 파일로 생성됩니다. 예: /services → /services/index.html
    format: 'directory',
  },
})
