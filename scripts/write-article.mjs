#!/usr/bin/env node
// ============================================================
// AI Writer Engine v1
//
// 실행: npm run write-article
//
// 키워드만 입력하면: 프롬프트 생성 → Claude API 호출 → 결과 검증(실패 시
// 오류 사유를 전달하며 최대 2회 재생성) → 미리보기 확인 → 자동 등록.
//
// 원칙:
// - 새 규칙 없음: 프롬프트(prompt-builder)·검증(article-validator)·
//   등록(article-importer)·정리(cleanJsonText) 전부 기존 모듈 재사용
// - 등록까지만 자동. git commit·push(실제 배포)는 사람이 검토 후 진행
// - API 키(ANTHROPIC_API_KEY)가 없으면 수동 방식 안내 후 종료
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { bold, red, green, yellow } from './lib/seo-checker.mjs'
import { isValidSlug, validateArticle } from './lib/article-validator.mjs'
import { buildArticlePrompt, sanitize, localToday } from './lib/prompt-builder.mjs'
import { hasApiKey, currentModel, generateText } from './lib/ai-client.mjs'
import { registerArticle, cleanJsonText } from './lib/article-importer.mjs'

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'content-drafts')
const MAX_REGENERATE = 2 // 검증 실패 시 재생성 최대 횟수

// ---------- 입력 처리 (파이프 입력에서 줄 유실 방지 — 기존 CLI와 동일) ----------
const pendingLines = []
const waiters = []
let stdinClosed = false

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const waiter = waiters.shift()
  if (waiter) waiter.resolve(line)
  else pendingLines.push(line)
})
rl.on('close', () => {
  stdinClosed = true
  for (const waiter of waiters.splice(0)) waiter.resolve(null)
})

function nextLine() {
  if (pendingLines.length > 0) return Promise.resolve(pendingLines.shift())
  if (stdinClosed) return Promise.resolve(null)
  return new Promise((resolve) => waiters.push({ resolve }))
}

async function askRequired(question) {
  for (;;) {
    process.stdout.write(question)
    const line = await nextLine()
    if (line === null) throw new Error('입력이 종료되었습니다. 모든 항목을 입력해 주세요.')
    const answer = sanitize(line)
    if (answer !== '') return answer
    console.log(red('  값을 입력해 주세요.'))
  }
}

async function askOptional(question, defaultValue = '') {
  process.stdout.write(question)
  const line = await nextLine()
  if (line === null) return defaultValue
  const answer = sanitize(line)
  return answer === '' ? defaultValue : answer
}

async function main() {
  console.log(bold('\nAI Writer Engine — 아티클 자동 생성'))
  console.log(`모델: ${currentModel()} (환경변수 AI_WRITER_MODEL로 변경 가능)\n`)

  // ---------- 0) API 키 확인 ----------
  if (!hasApiKey()) {
    console.error(red('ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다.'))
    console.error('설정 방법 (PowerShell):  $env:ANTHROPIC_API_KEY="발급받은 키"; npm run write-article')
    console.error('설정 방법 (CMD):         set ANTHROPIC_API_KEY=발급받은 키 && npm run write-article')
    console.error('\n키 없이 진행하려면 기존 수동 방식을 사용해 주세요: npm run draft-article → npm run import-ai')
    process.exit(1)
  }

  // ---------- 1) 사이트 ID ----------
  const envSite = typeof process.env.SITE === 'string' && process.env.SITE.trim() !== '' ? process.env.SITE.trim() : 'andrology'
  let siteId
  for (;;) {
    process.stdout.write(`1) 사이트 ID (Enter = ${envSite}): `)
    const line = await nextLine()
    if (line === null) {
      console.error(red('\n입력이 종료되었습니다.'))
      process.exit(1)
    }
    try {
      siteId = resolveSiteId(line.trim() === '' ? envSite : line.trim())
      break
    } catch (e) {
      console.log(red(`  ${e.message}`))
    }
  }

  const hospitalPath = join(ROOT, 'sites', siteId, 'hospital.json')
  if (!existsSync(hospitalPath)) {
    console.error(red(`\n사이트 "${siteId}"의 데이터 파일이 없습니다: sites/${siteId}/hospital.json`))
    process.exit(1)
  }
  let hospital
  try {
    hospital = JSON.parse(readFileSync(hospitalPath, 'utf-8'))
  } catch (e) {
    console.error(red(`sites/${siteId}/hospital.json을 읽을 수 없습니다: ${e.message}`))
    process.exit(1)
  }

  // ---------- 2) 키워드·slug ----------
  const mainKeyword = await askRequired('2) 핵심 키워드 (예: 전립선 비대증 원인): ')

  const existingSlugs = new Set((Array.isArray(hospital.articles) ? hospital.articles : []).map((a) => a.slug).filter(Boolean))
  let slug
  for (;;) {
    slug = (await askRequired('3) 글 주소용 slug (영문 소문자·숫자·하이픈): ')).toLowerCase()
    if (!isValidSlug(slug)) {
      console.log(red('  slug 형식이 잘못되었습니다. 영문 소문자·숫자·하이픈만 사용할 수 있습니다.'))
      continue
    }
    if (existingSlugs.has(slug)) {
      console.log(red(`  슬러그 "${slug}"는 이미 등록된 아티클입니다. 다른 slug를 입력해 주세요.`))
      continue
    }
    break
  }

  // ---------- 3) 나머지 입력 (Enter = 기본값) ----------
  const brief = {
    siteId,
    slug,
    mainKeyword,
    subKeywords: await askOptional('4) 보조 키워드 (쉼표 구분, Enter = 없음): ', ''),
    searchIntent: await askOptional('5) 검색 의도 (Enter = 정보 탐색): ', '정보 탐색'),
    audience: await askOptional('6) 대상 독자 (Enter = 해당 증상이나 질환 정보를 찾는 일반 사용자): ', '해당 증상이나 질환 정보를 찾는 일반 사용자'),
    purpose: await askOptional('7) 글의 목적 (Enter = 정확하고 이해하기 쉬운 의료 정보 제공): ', '정확하고 이해하기 쉬운 의료 정보 제공'),
    targetLength: await askOptional('8) 목표 분량 (Enter = 1800~2500자): ', '1800~2500자'),
    extraNotes: await askOptional('9) 추가 지시사항 (Enter = 없음): ', ''),
  }

  // ---------- 4) 브리프 저장 (실행 기록) + 프롬프트 생성 ----------
  const today = localToday()
  mkdirSync(DRAFTS_DIR, { recursive: true })
  writeFileSync(join(DRAFTS_DIR, `${slug}.brief.json`), JSON.stringify({ ...brief, createdAt: today }, null, 2) + '\n', 'utf-8')

  const basePrompt = buildArticlePrompt(hospital, brief, { today })
  console.log(green('\n프롬프트 생성 완료') + ` → Claude 호출 중... (최대 3분)`)

  // ---------- 5) AI 호출 → 검증 → 실패 시 재생성 ----------
  let article = null
  let lastResponse = ''
  for (let attempt = 0; attempt <= MAX_REGENERATE; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n## 이전 출력의 오류 (반드시 수정할 것)\n\n이전에 출력한 JSON에서 다음 오류가 발견되었습니다:\n${lastResponse}\n\n위 오류를 모두 수정해, 규칙에 맞는 유효한 JSON 객체 하나만 다시 출력하세요.`

    let text
    try {
      text = await generateText(prompt)
    } catch (e) {
      console.error(red(`\nAI 호출 실패: ${e.message}`))
      process.exit(1)
    }

    const cleaned = cleanJsonText(text)
    if (cleaned === null) {
      lastResponse = '- 응답이 JSON 객체({...}) 형식이 아니었습니다. 설명 없이 JSON만 출력해야 합니다.'
      console.log(yellow(`  응답이 JSON 형식이 아닙니다 — 재생성 요청 (${attempt + 1}/${MAX_REGENERATE})`))
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      lastResponse = `- JSON 파싱 오류: ${e.message}`
      console.log(yellow(`  JSON 파싱 실패 — 재생성 요청 (${attempt + 1}/${MAX_REGENERATE})`))
      continue
    }
    if (typeof parsed.slug === 'string' && parsed.slug !== slug) {
      parsed.slug = slug // slug는 CLI에서 결정한 값을 강제
    }
    const check = validateArticle(parsed)
    if (check.errors.length > 0) {
      lastResponse = check.errors.map((e) => `- ${e}`).join('\n')
      console.log(yellow(`  구조 검증 실패 ${check.errors.length}건 — 재생성 요청 (${attempt + 1}/${MAX_REGENERATE})`))
      if (attempt === MAX_REGENERATE) {
        const failedPath = join(DRAFTS_DIR, `${slug}.failed.txt`)
        writeFileSync(failedPath, text, 'utf-8')
        console.error(red(`\n재생성 ${MAX_REGENERATE}회 후에도 검증에 실패했습니다.`))
        console.error(`마지막 응답을 저장했습니다: content-drafts/${slug}.failed.txt`)
        console.error('내용을 확인·수정한 뒤 npm run import-ai 로 수동 등록할 수 있습니다.')
        process.exit(1)
      }
      continue
    }
    for (const w of check.warnings) console.log(`  ${yellow('⚠')} ${w}`)
    article = parsed
    break
  }

  if (!article) {
    console.error(red('\nAI 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
    process.exit(1)
  }

  // ---------- 6) 미리보기 + 등록 확인 ----------
  const sections = Array.isArray(article.sections) ? article.sections : []
  console.log(bold('\n[미리보기]'))
  console.log(`  제목: ${article.title}`)
  console.log(`  요약: ${article.summary}`)
  console.log(`  구성: 섹션 ${sections.length}개${Array.isArray(article.faq) ? ` / FAQ ${article.faq.length}개` : ''}${Array.isArray(article.relatedArticles) && article.relatedArticles.length ? ` / 관련 글 ${article.relatedArticles.length}개` : ''}`)
  sections.forEach((s, i) => console.log(`    ${i + 1}. ${s.heading}`))

  process.stdout.write('\n등록할까요? (Y/n): ')
  const confirmLine = await nextLine()
  rl.close()
  const confirm = (confirmLine ?? 'y').trim().toLowerCase()
  if (confirm === 'n' || confirm === 'no') {
    // 등록하지 않아도 초안은 남겨 사람이 검토·수정 후 import-ai로 등록할 수 있게 함
    const draftPath = join(DRAFTS_DIR, `${slug}.article.json`)
    writeFileSync(draftPath, JSON.stringify(article, null, 2) + '\n', 'utf-8')
    console.log(`등록을 취소했습니다. 초안은 남겨두었습니다: content-drafts/${slug}.article.json`)
    console.log('검토 후 npm run import-ai 또는 npm run create-article 로 등록할 수 있습니다.')
    process.exit(0)
  }

  // ---------- 7) 초안 저장 + 공용 파이프라인으로 등록 ----------
  writeFileSync(join(DRAFTS_DIR, `${slug}.article.json`), JSON.stringify(article, null, 2) + '\n', 'utf-8')
  const result = registerArticle(siteId, article, { rootDir: ROOT })
  if (!result.ok) {
    console.error(red('등록에 실패했습니다. 초안 파일은 남겨두었으니 수정 후 다시 시도해 주세요.'))
    process.exit(1)
  }

  console.log(bold('자동 생성 완료 요약'))
  console.log(`  브리프: content-drafts/${slug}.brief.json`)
  console.log(`  초안:   content-drafts/${slug}.article.json`)
  console.log(`  URL:    ${result.url}`)
  console.log('\n다음 단계: 내용 검토 후 git commit·push 하면 Cloudflare가 자동 배포합니다.\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
