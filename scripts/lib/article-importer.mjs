// ============================================================
// 아티클 등록 공용 로직
//
// create-article(파일 경로 입력)과 import-ai(터미널 붙여넣기)가
// 같은 등록 파이프라인을 재사용합니다. 등록 로직은 이 파일 한 곳에만 존재합니다.
//
// registerArticle(siteId, articleInput)
//   1) 입력 구조 검증 (article-validator 재사용)
//   2) 중복 slug 차단
//   3) 임시 파일 → 재검증 → 교체 방식의 안전 저장
//   4) 전체 SEO 검사 (seo-checker 재사용)
//   5) 오류 시 hospital.json 원본 복원
//
// 반환: { ok, article, url, seo } — process.exit는 호출한 쪽 책임입니다.
// ============================================================

import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeSiteUrl } from '../../src/lib/site-url.js'
import { runSeoCheck, red, green, yellow } from './seo-checker.mjs'
import { validateArticle } from './article-validator.mjs'

// 코드펜스와 앞뒤 공백 정리.
// 순수 JSON / ```json ... ``` / ``` ... ``` / 앞뒤 빈 줄 모두 허용.
// 그 외의 설명문이 붙어 있으면 null을 반환해 명확한 오류로 처리합니다.
// (import-ai와 write-article이 공유)
export function cleanJsonText(raw) {
  let text = raw.trim()
  const fenceOpen = text.match(/^```[a-zA-Z]*\s*\n/)
  if (fenceOpen) {
    text = text.slice(fenceOpen[0].length)
    const closeIdx = text.lastIndexOf('```')
    if (closeIdx !== -1) text = text.slice(0, closeIdx)
    text = text.trim()
  }
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  return text
}

export function registerArticle(siteId, articleInput, { rootDir = process.cwd() } = {}) {
  const hospitalPath = join(rootDir, 'sites', siteId, 'hospital.json')
  if (!existsSync(hospitalPath)) {
    console.error(red(`사이트 "${siteId}"의 데이터 파일이 없습니다: sites/${siteId}/hospital.json`))
    return { ok: false }
  }

  // ---------- 1) 입력 아티클 구조 검증 ----------
  const { errors, warnings, article } = validateArticle(articleInput)
  for (const w of warnings) console.log(`  ${yellow('⚠')} ${w}`)
  if (errors.length > 0) {
    for (const e of errors) console.log(`  ${red('✕')} ${e}`)
    console.error(red('\n입력 검증에 실패했습니다. hospital.json은 수정되지 않았습니다.'))
    return { ok: false }
  }

  console.log(green('\n아티클 입력 검증 완료'))
  console.log(`사이트: ${siteId}`)
  console.log(`슬러그: ${article.slug}`)

  // ---------- 2) 원본 로드 및 중복 슬러그 확인 ----------
  const originalString = readFileSync(hospitalPath, 'utf-8')
  let hospital
  try {
    hospital = JSON.parse(originalString)
  } catch (e) {
    console.error(red(`sites/${siteId}/hospital.json이 올바른 JSON이 아닙니다: ${e.message}`))
    return { ok: false }
  }
  if (!Array.isArray(hospital.articles)) {
    console.error(red(`sites/${siteId}/hospital.json에 articles 배열이 없습니다.`))
    return { ok: false }
  }
  const duplicate = hospital.articles.find((a) => typeof a.slug === 'string' && a.slug.trim().toLowerCase() === article.slug)
  if (duplicate) {
    console.error(red(`\n슬러그 "${article.slug}"는 이미 존재합니다.`))
    console.error('기존 아티클은 변경하지 않았습니다.')
    return { ok: false }
  }

  // ---------- 3) 안전한 갱신 (임시 파일 → 재검증 → 교체) ----------
  console.log('\n아티클 등록 중...')
  const tmpPath = hospitalPath + '.tmp'
  try {
    hospital.articles.push(article) // 배열 끝에 추가
    const nextString = JSON.stringify(hospital, null, 2) + '\n'
    writeFileSync(tmpPath, nextString, 'utf-8')
    JSON.parse(readFileSync(tmpPath, 'utf-8')) // 임시 파일 재파싱으로 손상 여부 확인
    renameSync(tmpPath, hospitalPath) // 같은 폴더 내 교체
  } catch (e) {
    rmSync(tmpPath, { force: true })
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`파일 저장에 실패하여 원본을 유지했습니다: ${e.message}`))
    return { ok: false }
  }

  // ---------- 4) 전체 SEO 검사 (기존 규칙 그대로 재사용) ----------
  console.log('전체 SEO 검사 실행 중...')
  let result
  try {
    const updated = JSON.parse(readFileSync(hospitalPath, 'utf-8'))
    result = runSeoCheck(updated, siteId, { print: true })
  } catch (e) {
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`SEO 검사를 실행하지 못해 hospital.json을 원래 상태로 복원했습니다: ${e.message}`))
    return { ok: false }
  }

  if (result.errors.length > 0) {
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`SEO 검증에서 오류 ${result.errors.length}개가 발견되었습니다.`))
    console.error('hospital.json을 원래 상태로 복원했습니다.')
    console.error('아티클은 등록되지 않았습니다.')
    return { ok: false, seo: result }
  }

  // ---------- 5) 완료 — canonical URL 표시 ----------
  let url = `/articles/${article.slug}/`
  try {
    url = `${normalizeSiteUrl(hospital.site?.url)}/articles/${article.slug}/`
  } catch {
    // site.url이 비정상이면 상대 경로만 표시 (전체 검사에서 이미 다뤄짐)
  }
  console.log(green('아티클 등록 완료'))
  console.log(`URL: ${url}`)
  const summaryParts = []
  if (article.sections) summaryParts.push(`섹션 ${article.sections.length}개`)
  if (article.faq) summaryParts.push(`FAQ ${article.faq.length}개`)
  if (article.relatedArticles) summaryParts.push(`관련 글 ${article.relatedArticles.length}개`)
  if (article.content) summaryParts.push(`본문 문단 ${article.content.length}개`)
  if (summaryParts.length > 0) console.log(`구성: ${summaryParts.join(' / ')}`)
  console.log(yellow('게시 전 의료 내용과 광고 표현을 담당자가 최종 검토해 주세요.\n'))

  return { ok: true, article, url, seo: result }
}
