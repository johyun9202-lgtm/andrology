#!/usr/bin/env node
// ============================================================
// Create Article CLI — Article Ingestion Pipeline
//
// 실행: npm run create-article
//
// 흐름:
//   글 작성(Claude/GPT 등) → JSON 초안 저장 → 이 CLI 실행
//   → 입력 구조 검증 → articles 배열에 추가 → 전체 SEO 검사
//   → 성공 시 저장 확정 / 실패 시 원본 hospital.json 복원
//
// 등록 핵심 로직은 scripts/lib/article-importer.mjs 공용 함수를 사용하며
// import-ai(터미널 붙여넣기) 명령과 동일한 파이프라인을 공유합니다.
// 외부 라이브러리·외부 AI API 없이 Node 내장 모듈만 사용합니다.
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { bold, red } from './lib/seo-checker.mjs'
import { registerArticle } from './lib/article-importer.mjs'

const ROOT = process.cwd()

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

  // ---------- 3) 공용 등록 파이프라인 실행 ----------
  const result = registerArticle(siteId, articleInput, { rootDir: ROOT })
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
