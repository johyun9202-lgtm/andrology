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
import { normalizeSiteUrl } from '../src/lib/site-url.js'
import { isValidSlug } from './lib/article-validator.mjs'
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

// 프롬프트 파일 구조를 깨뜨릴 수 있는 입력 정리:
// 제어문자 제거 + 코드펜스(```)를 무해한 따옴표로 치환
function sanitize(text) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/```/g, "'''")
    .trim()
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

// 로컬 기준 오늘 날짜 (YYYY-MM-DD)
function localToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

  // ---------- 사이트 정보 정리 ----------
  let siteUrl = ''
  try {
    siteUrl = normalizeSiteUrl(hospital.site?.url)
  } catch {
    siteUrl = '(사이트 URL 미설정)'
  }
  const services = (Array.isArray(hospital.services) ? hospital.services : [])
    .map((s) => `- ${s.title}${s.summary ? `: ${s.summary}` : ''}`)
    .join('\n') || '- (등록된 진료과목 없음)'
  const articleList = (Array.isArray(hospital.articles) ? hospital.articles : [])
    .map((a) => `- "${a.title}" (slug: ${a.slug})`)
    .join('\n') || '- (기존 아티클 없음 — relatedArticles는 빈 배열로 출력)'
  const siteFaq = (Array.isArray(hospital.faq) ? hospital.faq : [])
    .map((f) => `- ${f.question}`)
    .join('\n') || '- (사이트 FAQ 없음)'
  const isReal = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '미정'
  const contactNote = (!isReal(hospital.phone) || !isReal(hospital.address))
    ? '주의: 이 병원의 전화번호/주소는 아직 확정되지 않았습니다("미정"). 본문에 전화번호·주소·위치 정보를 사실처럼 쓰지 마세요.'
    : `참고: 병원 전화번호는 ${hospital.phone}, 주소는 ${hospital.address}입니다. 본문에 과도하게 반복하지 마세요.`
  const today = localToday()
  const existingSlugList = [...existingSlugs].join(', ') || '(없음)'

  // ---------- 프롬프트 Markdown 생성 ----------
  const md = `# 의료 SEO 아티클 작성 요청

## A. 역할

당신은 의료 SEO 콘텐츠 전문 작성자입니다. 다음 원칙을 반드시 지키세요.

- 의사의 진단을 대신하지 않습니다. 이 글은 정보 제공용 초안이며, 게시 전 전문의(병원 담당자) 검토가 필요합니다.
- 불안을 조장하거나, 치료 효과를 보장하거나, 과장된 표현을 사용하지 않습니다.
- 사실 확인이 필요한 수치·통계·가이드라인을 만들어내지 않습니다. 근거가 불확실하면 일반적인 표현으로 제한합니다.

## B. 사이트 정보

- 사이트명: ${sanitize(String(hospital.name ?? ''))}
- URL: ${siteUrl}
- 사이트 설명: ${sanitize(String(hospital.description ?? ''))}
- 진료과목:
${services}
- 기존 아티클 목록 (relatedArticles에는 아래 slug만 사용 가능):
${articleList}
- 사이트 FAQ (참고용 — 중복되는 질문은 이 글의 faq에 넣지 않기):
${siteFaq}
- ${contactNote}

## C. 글 작성 요청

- 핵심 키워드: ${mainKeyword}
- 보조 키워드: ${subKeywords || '(없음)'}
- 검색 의도: ${searchIntent}
- 대상 독자: ${audience}
- 글의 목적: ${purpose}
- 목표 분량: ${targetLength}
${extraNotes ? `- 추가 지시사항: ${extraNotes}` : ''}

## D. 콘텐츠 품질 기준

- 검색자가 가장 궁금해할 질문을 먼저 해결하는 구성으로 작성합니다.
- 키워드를 억지로 반복하지 않습니다.
- 제목과 요약은 구체적으로, 과장 없이 작성합니다.
- 의료 정보를 단정하지 말고 개인차가 있음을 안내합니다.
- 응급 상황이거나 진료가 필요한 경우에는 병원 방문을 적절히 안내합니다.
- 병원 광고성 표현을 과도하게 넣지 않습니다.
- 경쟁 병원이나 특정 의사를 비방하지 않습니다.
- 같은 내용을 반복해 분량을 채우지 않습니다.
- 일반 사용자가 이해하기 쉬운 한국어로 작성합니다.

## E. 출력 형식 (매우 중요)

최종 응답은 아래 구조의 **유효한 JSON 객체 하나만** 출력하세요.
설명, 인사말, 마크다운 코드펜스(백틱), 주석을 절대 붙이지 마세요.
응답의 첫 글자는 { 이고 마지막 글자는 } 여야 합니다.

{
  "slug": "${slug}",
  "title": "...",
  "summary": "...",
  "date": "${today}",
  "intro": "...",
  "sections": [
    {
      "heading": "...",
      "paragraphs": ["..."],
      "subsections": [
        {
          "heading": "...",
          "paragraphs": ["..."],
          "items": ["..."]
        }
      ]
    }
  ],
  "faq": [
    { "question": "...", "answer": "..." }
  ],
  "relatedArticles": []
}

규칙:

- slug는 반드시 "${slug}" 를 그대로 사용
- title은 15~60자
- summary는 50~160자
- date는 "${today}" 사용, updatedAt은 넣지 않음
- 본문은 sections만 사용 (content 필드는 만들지 않음)
- sections는 최소 3개 이상, 각 heading(H2)은 중복 금지
- subsections(H3)와 items(목록)는 필요할 때만 사용
- faq는 3~5개 (질문·답변 모두 실제 내용으로)
- relatedArticles에는 위 "기존 아티클 목록"의 slug만 사용 가능: ${existingSlugList}
- 적절한 관련 글이 없으면 relatedArticles는 빈 배열 []
- 모든 값에 HTML 태그, script, Markdown 문법을 넣지 않음
- 문자열 안에 줄바꿈(\\n)을 넣지 않음
- JSON 주석 금지, 후행 쉼표 금지

## F. 출력 전 자체 검수 (검수 결과는 응답에 출력하지 말 것)

출력 직전에 스스로 확인하세요: JSON 파싱 가능 여부 / slug가 "${slug}"와 정확히 일치하는지 /
필수 필드(slug, title, summary, sections) 누락 여부 / 제목·요약 길이 / H2·H3 중복 /
FAQ 중복 / HTML·script 포함 여부 / relatedArticles에 존재하지 않는 slug가 없는지 /
치료 효과 보장·단정적 진단 표현이 없는지 / 반복 문장으로 분량을 채우지 않았는지.
`

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
