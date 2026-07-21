// ============================================================
// 사이트 데이터 로딩 + 아티클 병합 (Phase 7.5)
//
// 아티클 원본은 두 곳에 있을 수 있으며, 이 함수가 하나로 병합합니다.
//   1) sites/<siteId>/hospital.json 의 articles 배열 (기존 방식 — 계속 지원)
//   2) sites/<siteId>/articles/<slug>.json 개별 파일 (신규 게시 방식)
//
// 병합 순서(결정적): hospital.json 배열 순서 그대로 → 개별 파일을 파일명 오름차순.
// slug 중복·깨진 JSON·Article Model 위반은 어느 파일이 문제인지 명시해 즉시 오류
// → check:seo / 빌드가 중단되어 잘못된 상태로 배포되지 않습니다.
//
// 사용처: src/lib/site-data.js (Astro 빌드·검사 스크립트),
//         scripts/generate-writer-site-data.mjs (Functions용 SITE_DATA 생성)
// 두 곳 모두 빌드 시점의 Node에서 실행됩니다. (Workers에서는 이 파일을 직접
// 읽지 않고, 빌드 시 생성된 site-data.generated.js를 사용합니다)
// ============================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateArticle } from '../../scripts/lib/article-validator.mjs'
import { resolveTemplateId, getTemplate } from './templates.js'

export function loadHospital(siteId, { rootDir = process.cwd() } = {}) {
  const siteDir = join(rootDir, 'sites', siteId)
  const hospitalPath = join(siteDir, 'hospital.json')

  let rawJson
  try {
    rawJson = readFileSync(hospitalPath, 'utf-8')
  } catch {
    throw new Error(
      `[SITE 오류] 사이트 "${siteId}"의 데이터 파일이 없습니다: sites/${siteId}/hospital.json ` +
        '— 폴더 이름과 SITE 값이 일치하는지 확인해 주세요.'
    )
  }

  let hospital
  try {
    hospital = JSON.parse(rawJson)
  } catch (e) {
    throw new Error(`[SITE 오류] sites/${siteId}/hospital.json이 올바른 JSON이 아닙니다: ${e.message}`)
  }

  const baseArticles = Array.isArray(hospital.articles) ? hospital.articles : []

  // ---------- 개별 아티클 파일 병합 (폴더가 없으면 그대로 통과) ----------
  const articlesDir = join(siteDir, 'articles')
  const fileArticles = []
  const fileNames = []
  if (existsSync(articlesDir)) {
    const files = readdirSync(articlesDir)
      .filter((name) => name.endsWith('.json')) // .gitkeep 등은 무시
      .sort() // 결정적 로딩 순서
    for (const file of files) {
      const relPath = `sites/${siteId}/articles/${file}`
      let parsed
      try {
        parsed = JSON.parse(readFileSync(join(articlesDir, file), 'utf-8'))
      } catch (e) {
        throw new Error(`[아티클 파일 오류] ${relPath} 이(가) 올바른 JSON이 아닙니다: ${e.message}`)
      }
      const { errors, article } = validateArticle(parsed)
      if (errors.length > 0 || !article) {
        throw new Error(`[아티클 파일 오류] ${relPath} 이(가) Article Model 검증에 실패했습니다: ${errors[0] ?? '구조 오류'}`)
      }
      if (`${article.slug}.json` !== file) {
        throw new Error(`[아티클 파일 오류] ${relPath} 의 파일명과 slug("${article.slug}")가 일치하지 않습니다. 파일명은 <slug>.json 이어야 합니다.`)
      }
      fileArticles.push(article)
      fileNames.push(relPath)
    }
  }

  // ---------- slug 중복 검사 (배열 내부 / 파일 간 / 배열↔파일) ----------
  const merged = [...baseArticles, ...fileArticles]
  const seen = new Map() // 소문자 slug → 출처 설명
  merged.forEach((article, index) => {
    const slug = typeof article?.slug === 'string' ? article.slug.trim().toLowerCase() : ''
    if (slug === '') return // slug 누락은 SEO 검사에서 별도 오류 처리
    const source =
      index < baseArticles.length
        ? `sites/${siteId}/hospital.json (articles 배열)`
        : fileNames[index - baseArticles.length]
    if (seen.has(slug)) {
      throw new Error(`[slug 중복] "${slug}" — ${seen.get(slug)} 과(와) ${source} 이(가) 충돌합니다. 한쪽을 제거하거나 slug를 변경해 주세요.`)
    }
    seen.set(slug, source)
  })

  // ---------- 템플릿 결정 (Phase 10) ----------
  // template 필드가 없으면 기본 'medical' → 기존 사이트는 동작이 전혀 바뀌지 않음.
  // (기본값일 때는 Registry 조회를 하지 않아 기존 로더 사용처와 완전 호환)
  // template을 명시한 경우에만 검증 — 등록되지 않은 값은 명확한 오류로 빌드 중단.
  const templateId = resolveTemplateId(hospital.template)
  if (typeof hospital.template === 'string' && hospital.template.trim() !== '') {
    getTemplate(templateId, { rootDir }) // 존재·구조 검증
  }

  return { ...hospital, articles: merged, template: templateId }
}
