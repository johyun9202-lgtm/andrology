// robots.txt 자동 생성 (정적 엔드포인트)
// 도메인은 hospital.json(site.url)에서 파생되므로
// 병원이 바뀌어도 이 파일은 수정할 필요가 없습니다.

import { site } from '../config/site.js'

export function GET() {
  const body = `User-agent: *
Allow: /

Sitemap: ${site.siteUrl}/sitemap-index.xml
`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
