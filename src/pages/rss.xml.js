// /rss.xml — 네이버 서치어드바이저 등록 등에 필요한 RSS 피드.
//
// - 병원(고객) 사이트: 실제 아티클을 그대로 노출합니다.
// - 회사(AI SEO Lab) 홈페이지: 내부 도구라 외부에 알릴 콘텐츠가 아니므로
//   과거 noindex 처리와 동일한 기준으로 빈 피드를 냅니다(경로 자체는
//   유지 — 네이버 등록 도구가 404를 만나지 않도록).
import rss from '@astrojs/rss'
import { siteData as hospital, siteId } from '../lib/site-data.js'
import { COMPANY_SITE } from '../lib/site-id.js'
import { site } from '../config/site.js'

export async function GET(context) {
  const isCompanySite = siteId === COMPANY_SITE
  const articles = isCompanySite ? [] : Array.isArray(hospital.articles) ? hospital.articles : []

  const items = [...articles]
    .filter((a) => a && typeof a.slug === 'string' && typeof a.title === 'string')
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .map((article) => ({
      title: article.title,
      description: article.summary ?? '',
      pubDate: article.date ? new Date(article.date) : undefined,
      link: `/articles/${article.slug}/`,
    }))

  return rss({
    title: hospital.name ?? site.siteUrl,
    description: hospital.description ?? '',
    site: context.site ?? site.siteUrl,
    items,
  })
}
