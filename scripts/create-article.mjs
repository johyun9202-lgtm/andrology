#!/usr/bin/env node
// ============================================================
// Create Article CLI (1차) — Article Ingestion Pipeline
//
// 실행: npm run create-article
//
// 흐름:
//   글 작성(Claude/GPT 등) → JSON 초안 저장 → 이 CLI 실행
//   → 입력 구조 검증 → articles 배열에 추가 → 전체 SEO 검사
//   → 성공 시 저장 확정 / 실패 시 원본 hospital.json 복원
//
// 외부 라이브러리·외부 AI API 없이 Node 내장 모듈만 사용합니다.
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { normalizeSiteUrl } from '../src/lib/site-url.js'
import { runSeoCheck, bold, red, green, yellow } from './lib/seo-checker.mjs'
import { validateArticle } from './lib/article-validator.mjs'

const ROOT = process.cwd()

// ---------- 입력 처리 (create-site와 동일 — 파이프 입력에서 줄 유실 방지) ----------
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
    const answer = (await nextLine()).trim()
    if (answer !== '') return answer
    console.log(red('  값을 입력해 주세요.'))
  }
}

// 경로 입력의 앞뒤 공백·따옴표 제거 (Windows에서 파일을 드래그하면 따옴표가 붙을 수 있음)
function cleanPathInput(raw) {
  return raw.trim().replace(/^["']|["']$/g, '').trim()
}

async function main() {
  console.log(bold('\n새 SEO 아티클 등록'))
  console.log('입력 방식: JSON 파일\n')

  // ---------- 1) 사이트 ID ----------
  const envSite = typeof process.env.SITE === 'string' && process.env.SITE.trim() !== '' ? process.env.SITE.trim() : 'andrology'
  let siteId
  for (;;) {
    process.stdout.write(`1) 사이트 ID (Enter = ${envSite}): `)
    const raw = (await nextLine()).trim()
    try {
      siteId = resolveSiteId(raw === '' ? envSite : raw) // 기존 검증 규칙 재사용
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

  // ---------- 2) 아티클 JSON 파일 경로 ----------
  let articleInput
  for (;;) {
    const raw = cleanPathInput(await askRequired('2) 아티클 JSON 파일 경로: '))
    const filePath = isAbsolute(raw) ? raw : join(ROOT, raw)
    if (!existsSync(filePath)) {
      console.log(red(`  파일을 찾을 수 없습니다: ${filePath}`))
      continue
    }
    try {
      articleInput = JSON.parse(readFileSync(filePath, 'utf-8'))
      break
    } catch (e) {
      console.log(red(`  JSON을 읽을 수 없습니다 (형식 오류): ${e.message}`))
      console.log('  파일을 수정한 뒤 경로를 다시 입력해 주세요.')
    }
  }

  rl.close()

  // ---------- 3) 입력 아티클 구조 검증 ----------
  const { errors, warnings, article } = validateArticle(articleInput)
  for (const w of warnings) console.log(`  ${yellow('⚠')} ${w}`)
  if (errors.length > 0) {
    for (const e of errors) console.log(`  ${red('✕')} ${e}`)
    console.error(red('\n입력 검증에 실패했습니다. hospital.json은 수정되지 않았습니다.'))
    process.exit(1)
  }

  console.log(green('\n아티클 입력 검증 완료'))
  console.log(`사이트: ${siteId}`)
  console.log(`슬러그: ${article.slug}`)

  // ---------- 4) 원본 로드 및 중복 슬러그 확인 ----------
  const originalString = readFileSync(hospitalPath, 'utf-8')
  let hospital
  try {
    hospital = JSON.parse(originalString)
  } catch (e) {
    console.error(red(`sites/${siteId}/hospital.json이 올바른 JSON이 아닙니다: ${e.message}`))
    process.exit(1)
  }
  if (!Array.isArray(hospital.articles)) {
    console.error(red(`sites/${siteId}/hospital.json에 articles 배열이 없습니다.`))
    process.exit(1)
  }
  const duplicate = hospital.articles.find((a) => typeof a.slug === 'string' && a.slug.trim().toLowerCase() === article.slug)
  if (duplicate) {
    console.error(red(`\n슬러그 "${article.slug}"는 이미 존재합니다.`))
    console.error('기존 아티클은 변경하지 않았습니다.')
    process.exit(1)
  }

  // ---------- 5) 안전한 갱신 (임시 파일 → 재검증 → 교체) ----------
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
    // 원본은 아직 교체 전이거나, 만약을 위해 원본 문자열로 복원
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`파일 저장에 실패하여 원본을 유지했습니다: ${e.message}`))
    process.exit(1)
  }

  // ---------- 6) 전체 SEO 검사 (기존 규칙 그대로 재사용) ----------
  console.log('전체 SEO 검사 실행 중...')
  let result
  try {
    const updated = JSON.parse(readFileSync(hospitalPath, 'utf-8'))
    result = runSeoCheck(updated, siteId, { print: true })
  } catch (e) {
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`SEO 검사를 실행하지 못해 hospital.json을 원래 상태로 복원했습니다: ${e.message}`))
    process.exit(1)
  }

  if (result.errors.length > 0) {
    writeFileSync(hospitalPath, originalString, 'utf-8')
    console.error(red(`SEO 검증에서 오류 ${result.errors.length}개가 발견되었습니다.`))
    console.error('hospital.json을 원래 상태로 복원했습니다.')
    console.error('아티클은 등록되지 않았습니다.')
    process.exit(1)
  }

  // ---------- 7) 완료 — canonical URL 표시 ----------
  let url = `/articles/${article.slug}/`
  try {
    url = `${normalizeSiteUrl(hospital.site?.url)}/articles/${article.slug}/`
  } catch {
    // site.url이 비정상이면 상대 경로만 표시 (전체 검사에서 이미 경고/오류로 다뤄짐)
  }
  console.log(green('아티클 등록 완료'))
  console.log(`URL: ${url}`)
  console.log(yellow('게시 전 의료 내용과 광고 표현을 담당자가 최종 검토해 주세요.\n'))
  process.exit(0)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
