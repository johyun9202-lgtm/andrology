#!/usr/bin/env node
// ============================================================
// AI Draft Prompt Generator v1
//
// 실행: npm run draft-article
//
// 외부 AI API를 호출하지 않습니다.
// 대신 Claude/ChatGPT/Gemini에 붙여넣을 수 있는
// 고품질 아티클 생성 프롬프트(.prompt.md)를 만들어 줍니다.
//
// 흐름:
//   npm run draft-article → 질문 답변 → content-drafts/{slug}.prompt.md 생성
//   → AI에 붙여넣기 → 받은 JSON을 content-drafts/{slug}.article.json 저장
//   → npm run create-article 로 등록
//
// 사이트 원본(hospital.json)은 어떤 경우에도 수정하지 않습니다.
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { isValidSlug } from './lib/article-validator.mjs'
import { buildArticlePrompt, sanitize, localToday } from './lib/prompt-builder.mjs'
import { bold, red, green, yellow } from './lib/seo-checker.mjs'

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'content-drafts')

// ---------- 입력 처리 (create-site/create-article과 동일 — 파이프 입력 줄 유실 방지) ----------
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
  for (const waiter of waiters.splice(0)) {
    waiter.reject(new Error('입력이 종료되었습니다. 모든 항목을 입력해 주세요.'))
  }
})

function nextLine() {
  if (pendingLines.length > 0) return Promise.resolve(pendingLines.shift())
  if (stdinClosed) return Promise.reject(new Error('입력이 종료되었습니다. 모든 항목을 입력해 주세요.'))
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
}

async function askRequired(question) {
  for (;;) {
    process.stdout.write(question)
    const answer = sanitize(await nextLine())
    if (answer !== '') return answer
    console.log(red('  값을 입력해 주세요.'))
  }
}

async function askOptional(question, defaultValue = '') {
  process.stdout.write(question)
  const answer = sanitize(await nextLine())
  return answer === '' ? defaultValue : answer
}

async function main() {
  console.log(bold('\nAI 아티클 프롬프트 생성'))
  console.log('외부 AI를 호출하지 않고, Claude/ChatGPT에 붙여넣을 프롬프트 파일을 만듭니다.\n')

  // ---------- 1) 사이트 ID ----------
  const envSite = typeof process.env.SITE === 'string' && process.env.SITE.trim() !== '' ? process.env.SITE.trim() : 'andrology'
  let siteId
  for (;;) {
    process.stdout.write(`1) 사이트 ID (Enter = ${envSite}): `)
    const raw = (await nextLine()).trim()
    try {
      siteId = resolveSiteId(raw === '' ? envSite : raw) // 기존 검증 규칙 재사용 (경로 조작 차단)
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

  // ---------- 2) 핵심 키워드 ----------
  const mainKeyword = await askRequired('2) 핵심 키워드 (예: 전립선 비대증 원인): ')

  // ---------- 3) slug (영문 파일명/주소 — 직접 입력, 한글 키워드를 억지로 번역하지 않음) ----------
  const existingSlugs = new Set((Array.isArray(hospital.articles) ? hospital.articles : []).map((a) => a.slug).filter(Boolean))
  let slug
  for (;;) {
    slug = (await askRequired('3) 글 주소용 slug (영문 소문자·숫자·하이픈, 예: prostate-enlargement-causes): ')).toLowerCase()
    if (!isValidSlug(slug)) {
      console.log(red('  slug 형식이 잘못되었습니다. 영문 소문자·숫자·하이픈만 사용하고, 하이픈으로 시작·끝나거나 연속 하이픈은 사용할 수 없습니다.'))
      continue
    }
    break
  }

  // ---------- 충돌 검사 (덮어쓰기 금지) ----------
  const promptPath = join(DRAFTS_DIR, `${slug}.prompt.md`)
  const articleJsonPath = join(DRAFTS_DIR, `${slug}.article.json`)
  if (existingSlugs.has(slug)) {
    console.error(red(`\n슬러그 "${slug}"는 이미 사이트에 등록된 아티클입니다. 다른 slug를 사용해 주세요.`))
    process.exit(1)
  }
  if (existsSync(promptPath)) {
    console.error(red(`\n이미 존재하는 프롬프트 파일이 있습니다: content-drafts/${slug}.prompt.md`))
    console.error('기존 파일은 덮어쓰지 않았습니다.')
    process.exit(1)
  }
  if (existsSync(articleJsonPath)) {
    console.error(red(`\n이미 존재하는 아티클 초안이 있습니다: content-drafts/${slug}.article.json`))
    console.error('기존 파일은 덮어쓰지 않았습니다.')
    process.exit(1)
  }

  // ---------- 4) 나머지 입력 (Enter = 기본값) ----------
  const subKeywords = await askOptional('4) 보조 키워드 (쉼표 구분, Enter = 없음): ', '')
  const searchIntent = await askOptional('5) 검색 의도 (Enter = 정보 탐색): ', '정보 탐색')
  const audience = await askOptional('6) 대상 독자 (Enter = 해당 증상이나 질환 정보를 찾는 일반 사용자): ', '해당 증상이나 질환 정보를 찾는 일반 사용자')
  const purpose = await askOptional('7) 글의 목적 (Enter = 정확하고 이해하기 쉬운 의료 정보 제공): ', '정확하고 이해하기 쉬운 의료 정보 제공')
  const targetLength = await askOptional('8) 목표 분량 (Enter = 1800~2500자): ', '1800~2500자')
  const extraNotes = await askOptional('9) 추가 지시사항 (Enter = 없음): ', '')

  rl.close()

  // ---------- 프롬프트 생성 (공용 빌더 재사용) ----------
  const md = buildArticlePrompt(hospital, {
    slug,
    mainKeyword,
    subKeywords,
    searchIntent,
    audience,
    purpose,
    targetLength,
    extraNotes,
  }, { today: localToday() })

  // ---------- 원자적 저장 (임시 파일 → rename) ----------
  const tmpPath = promptPath + '.tmp'
  try {
    mkdirSync(DRAFTS_DIR, { recursive: true })
    writeFileSync(tmpPath, md, 'utf-8')
    renameSync(tmpPath, promptPath)
  } catch (e) {
    rmSync(tmpPath, { force: true })
    console.error(red(`프롬프트 파일 생성에 실패했습니다: ${e.message}`))
    process.exit(1)
  }

  // ---------- 완료 안내 ----------
  console.log(green('\n프롬프트 생성 완료'))
  console.log(`사이트: ${siteId}`)
  console.log(`슬러그: ${slug}`)
  console.log(`파일: content-drafts/${slug}.prompt.md`)
  console.log(bold('\n다음 단계'))
  console.log(`  1. 파일 열기:  notepad content-drafts\\${slug}.prompt.md`)
  console.log('  2. 내용 전체를 복사해 Claude 또는 ChatGPT에 붙여넣기')
  console.log(`  3. AI가 출력한 JSON을 content-drafts\\${slug}.article.json 파일로 저장`)
  console.log('  4. npm run create-article 실행 후 위 파일 경로 입력')
  console.log(yellow('\n게시 전 의료 내용과 광고 표현을 담당자가 최종 검토해 주세요.\n'))
  process.exit(0)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
