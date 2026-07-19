#!/usr/bin/env node
// ============================================================
// Create Site CLI (1차)
//
// 실행: npm run create-site
//
// templates/hospital/hospital.json을 기반으로
// sites/<사이트ID>/hospital.json을 대화형으로 생성합니다.
// 생성 직후 SEO 검사를 자동 실행하며,
// 오류가 있으면 생성 파일을 제거합니다.
//
// 외부 라이브러리 없이 Node 내장 모듈만 사용합니다.
// ============================================================

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSiteId } from '../src/lib/site-id.js'
import { normalizeSiteUrl } from '../src/lib/site-url.js'
import { runSeoCheck, bold, red, green } from './lib/seo-checker.mjs'

const ROOT = process.cwd()
const TEMPLATE_PATH = join(ROOT, 'templates', 'hospital', 'hospital.json')

// ---------- 입력 처리 ----------
// 터미널 직접 입력과 파이프 입력(자동화) 모두에서 줄이 유실되지 않도록
// 들어온 줄을 큐에 보관했다가 질문 순서대로 꺼내 씁니다.
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

// 빈 값이 아닐 때까지 다시 묻는 입력 도우미
async function askRequired(question) {
  for (;;) {
    process.stdout.write(question)
    const answer = (await nextLine()).trim()
    if (answer !== '') return answer
    console.log(red('  값을 입력해 주세요.'))
  }
}

async function main() {
  console.log(bold('\n새 병원 사이트 생성'))
  console.log('템플릿: hospital\n')

  // 템플릿 존재 확인
  if (!existsSync(TEMPLATE_PATH)) {
    console.error(red('템플릿 파일이 없습니다: templates/hospital/hospital.json'))
    process.exit(1)
  }

  // ---------- 1) 사이트 ID ----------
  let siteId
  for (;;) {
    const raw = await askRequired('1) 사이트 ID (영문 소문자·숫자·하이픈, 예: gwangju-clinic): ')
    try {
      siteId = resolveSiteId(raw) // 기존 검증 규칙 재사용 (경로 조작 차단 포함)
      break
    } catch (e) {
      console.log(red(`  ${e.message}`))
    }
  }

  // ---------- 중복 사이트 방지 ----------
  const siteDir = join(ROOT, 'sites', siteId)
  const siteFile = join(siteDir, 'hospital.json')
  if (existsSync(siteDir) || existsSync(siteFile)) {
    console.error(red(`\n사이트 "${siteId}"는 이미 존재합니다.`))
    console.error('기존 사이트는 덮어쓰지 않았습니다.')
    process.exit(1)
  }

  // ---------- 2) 병원명 ----------
  const hospitalName = await askRequired('2) 병원명: ')

  // ---------- 3) 사이트 URL ----------
  let siteUrl
  for (;;) {
    const raw = await askRequired('3) 사이트 URL (예: https://example.com): ')
    try {
      siteUrl = normalizeSiteUrl(raw) // 기존 검증·정규화 기준 재사용
      break
    } catch (e) {
      console.log(red(`  ${e.message}`))
    }
  }

  // ---------- 4) 전화번호 / 5) 주소 ----------
  const phone = await askRequired('4) 전화번호: ')
  const address = await askRequired('5) 주소: ')

  rl.close()

  // ---------- 템플릿 로드 및 값 치환 ----------
  let data
  try {
    data = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8'))
  } catch (e) {
    console.error(red(`템플릿 JSON을 읽을 수 없습니다: ${e.message}`))
    process.exit(1)
  }

  // 실제 키 이름 기준 치환 (name / site.url / phone / address)
  data.name = hospitalName
  data.site = { ...data.site, url: siteUrl }
  data.phone = phone
  data.address = address

  // ---------- 파일 생성 (실패 시 반쯤 생성된 폴더가 남지 않게 처리) ----------
  try {
    mkdirSync(siteDir, { recursive: true })
    // 한글이 유니코드 이스케이프되지 않도록 JSON.stringify 기본 동작 사용, 들여쓰기 2칸 + 마지막 개행
    writeFileSync(siteFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  } catch (e) {
    rmSync(siteDir, { recursive: true, force: true })
    console.error(red(`파일 생성에 실패했습니다: ${e.message}`))
    process.exit(1)
  }

  console.log(bold('\n사이트 생성 완료'))
  console.log(`사이트 ID: ${siteId}`)
  console.log(`데이터 경로: sites/${siteId}/hospital.json`)
  console.log('\nSEO 검사 실행 중...')

  // ---------- 생성 후 SEO 검사 (공통 검사 함수 직접 재사용) ----------
  let result
  try {
    const written = JSON.parse(readFileSync(siteFile, 'utf-8'))
    result = runSeoCheck(written, siteId, { print: true })
  } catch (e) {
    // 검사 "실행 자체"의 실패 — 데이터 오류와 구분해 파일은 남겨둡니다.
    console.error(red(`SEO 검사를 실행하지 못했습니다 (환경 문제일 수 있습니다): ${e.message}`))
    console.error('생성된 파일은 남겨두었습니다. 수동으로 npm run check:seo 를 실행해 확인해 주세요.')
    process.exit(1)
  }

  if (result.errors.length > 0) {
    rmSync(siteDir, { recursive: true, force: true })
    console.error(red('검증에 실패하여 생성 파일을 제거했습니다.'))
    process.exit(1)
  }

  console.log(green('생성 성공') + ' — 로컬 확인 방법:')
  console.log('  Windows CMD:  set SITE=' + siteId + ' && npm run dev')
  console.log('  PowerShell:   $env:SITE="' + siteId + '"; npm run dev')
  console.log('  Linux/macOS:  SITE=' + siteId + ' npm run dev')
  console.log('자세한 내용: docs/create-site.md\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(red(`오류가 발생했습니다: ${e.message}`))
  process.exit(1)
})
