#!/usr/bin/env node
// ============================================================
// AI Importer v1
//
// 실행: npm run import-ai
//
// Claude/ChatGPT가 반환한 아티클 JSON을 터미널에 그대로 붙여넣으면
// ① JSON 정리(코드펜스 제거) → ② 구조 검증 → ③ content-drafts 저장
// → ④ 기존 등록 파이프라인(article-importer)으로 자동 등록까지 처리합니다.
//
// 외부 AI API를 호출하지 않으며, Node 내장 모듈만 사용합니다.
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { bold, red, green, yellow } from './lib/seo-checker.mjs'
import { validateArticle } from './lib/article-validator.mjs'
import { registerArticle, cleanJsonText } from './lib/article-importer.mjs'

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'content-drafts')

// ---------- 입력 처리 (파이프 입력에서 줄 유실 방지) ----------
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
    if (waiter.onEof) waiter.resolve(null)
    else waiter.reject(new Error('입력이 종료되었습니다.'))
  }
})

// onEof=true면 스트림 종료(EOF) 시 오류 대신 null을 반환합니다.
function nextLine({ onEof = false } = {}) {
  if (pendingLines.length > 0) return Promise.resolve(pendingLines.shift())
  if (stdinClosed) return onEof ? Promise.resolve(null) : Promise.reject(new Error('입력이 종료되었습니다.'))
  return new Promise((resolve, reject) => waiters.push({ resolve, reject, onEof }))
}

// 여러 줄 JSON 수집: 한 줄에 END만 입력하거나 입력 스트림이 끝나면 종료
async function collectMultilineJson() {
  const lines = []
  for (;;) {
    const line = await nextLine({ onEof: true })
    if (line === null) break // EOF (파이프 입력 종료 / Ctrl+Z Enter / Ctrl+D)
    if (line.trim() === 'END') break
    lines.push(line)
  }
  return lines.join('\n')
}

async function askYesNo(question) {
  process.stdout.write(question)
  const answer = ((await nextLine({ onEof: true })) ?? '').trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}

async function main() {
  console.log(bold('\nAI 아티클 가져오기 (import-ai)'))
  console.log('Claude/ChatGPT가 출력한 JSON을 붙여넣으면 저장과 등록까지 자동 처리합니다.\n')

  // ---------- 1) 사이트 ID ----------
  const envSite = typeof process.env.SITE === 'string' && process.env.SITE.trim() !== '' ? process.env.SITE.trim() : 'andrology'
  let siteId
  for (;;) {
    process.stdout.write(`1) 사이트 ID (Enter = ${envSite}): `)
    let raw
    try {
      raw = (await nextLine()).trim()
    } catch (e) {
      console.error(red(`\n${e.message}`))
      process.exit(1)
    }
    try {
      siteId = resolveSiteId(raw === '' ? envSite : raw)
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

  // ---------- 2) JSON 붙여넣기 ----------
  console.log('\n2) 아래에 아티클 JSON 전체를 붙여넣어 주세요.')
  console.log(yellow('   붙여넣은 뒤, 새 줄에 END 를 입력하고 Enter를 누르면 입력이 끝납니다.'))
  console.log(yellow('   (```json 코드펜스가 포함되어 있어도 자동으로 제거됩니다)\n'))

  const rawText = await collectMultilineJson()
  if (rawText.trim() === '') {
    console.error(red('입력된 내용이 없습니다.'))
    process.exit(1)
  }

  // ---------- 3) JSON 정리 및 파싱 ----------
  const cleaned = cleanJsonText(rawText)
  if (cleaned === null) {
    console.error(red('\nJSON을 찾을 수 없습니다. 붙여넣은 내용이 { 로 시작해 } 로 끝나는 JSON이어야 합니다.'))
    console.error('AI 응답에 설명문이 함께 있다면, JSON 부분({ 부터 } 까지)만 복사해 다시 실행해 주세요.')
    process.exit(1)
  }
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error(red(`\nJSON 형식 오류: ${e.message}`))
    console.error('AI에게 "유효한 JSON만 다시 출력해 달라"고 요청한 뒤 다시 시도해 주세요.')
    process.exit(1)
  }

  // ---------- 4) 저장·등록 전 사전 검사 (실패 시 아무것도 만들지 않음) ----------
  const pre = validateArticle(parsed)
  if (pre.errors.length > 0) {
    for (const e of pre.errors) console.log(`  ${red('✕')} ${e}`)
    console.error(red('\n아티클 구조 검증에 실패했습니다. 파일과 사이트 데이터는 변경되지 않았습니다.'))
    process.exit(1)
  }
  const slug = pre.article.slug

  // 중복 slug 사전 확인 (저장 전에 차단)
  try {
    const hospital = JSON.parse(readFileSync(hospitalPath, 'utf-8'))
    if ((hospital.articles ?? []).some((a) => typeof a.slug === 'string' && a.slug.trim().toLowerCase() === slug)) {
      console.error(red(`\n슬러그 "${slug}"는 이미 사이트에 등록되어 있습니다. 파일을 저장하지 않았습니다.`))
      process.exit(1)
    }
  } catch (e) {
    console.error(red(`sites/${siteId}/hospital.json을 읽을 수 없습니다: ${e.message}`))
    process.exit(1)
  }

  // ---------- 5) content-drafts 저장 (덮어쓰기 확인, 기본 No) ----------
  const draftPath = join(DRAFTS_DIR, `${slug}.article.json`)
  const draftExisted = existsSync(draftPath)
  const draftBackup = draftExisted ? readFileSync(draftPath, 'utf-8') : null
  if (draftExisted) {
    const overwrite = await askYesNo(yellow(`\ncontent-drafts/${slug}.article.json 파일이 이미 있습니다. 덮어쓸까요? (y/N): `))
    if (!overwrite) {
      console.error('기존 파일을 유지하고 종료합니다. 아무것도 변경되지 않았습니다.')
      process.exit(1)
    }
  }
  rl.close()

  try {
    mkdirSync(DRAFTS_DIR, { recursive: true })
    writeFileSync(draftPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
  } catch (e) {
    console.error(red(`초안 저장에 실패했습니다: ${e.message}`))
    process.exit(1)
  }
  console.log(green(`\n초안 저장 완료: content-drafts/${slug}.article.json`))

  // ---------- 6) 공용 등록 파이프라인 실행 ----------
  const result = registerArticle(siteId, parsed, { rootDir: ROOT })

  if (!result.ok) {
    // 등록 실패 시 초안 파일도 원래 상태로 되돌립니다 (부분 변경 방지)
    if (draftExisted && draftBackup !== null) writeFileSync(draftPath, draftBackup, 'utf-8')
    else rmSync(draftPath, { force: true })
    console.error(red('등록에 실패하여 초안 파일을 원래 상태로 되돌렸습니다.'))
    process.exit(1)
  }

  // ---------- 7) 성공 요약 ----------
  console.log(bold('가져오기 완료 요약'))
  console.log(`  저장 파일: content-drafts/${slug}.article.json`)
  console.log(`  등록 사이트: ${siteId}`)
  console.log(`  슬러그: ${slug}`)
  console.log(`  URL: ${result.url}`)
  console.log(`  SEO: 오류 ${result.seo.errors.length}개 / 경고 ${result.seo.warnings.length}개`)
  console.log('\n다음 단계: 내용 확인 후 git commit·push 하면 Cloudflare가 자동 배포합니다.\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
