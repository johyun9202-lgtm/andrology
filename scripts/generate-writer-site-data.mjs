// ============================================================
// AI Writer용 사이트 데이터 생성기
//
// sites/<siteId>/hospital.json 전체를 읽어
// functions/_lib/site-data.generated.js (일반 JS 모듈)로 변환합니다.
//
// 이유: Pages Functions에서 JSON을 직접 import 하는 특수 구문
// (`with { type: 'json' }`)은 번들러 버전에 따라 배포가 실패할 수 있어,
// 어떤 번들러에서도 안전한 일반 JS 모듈을 빌드 시점에 생성합니다.
//
// - 단일 원천은 여전히 sites/<siteId>/hospital.json 입니다.
// - 이 파일은 npm run build 에 포함되어 배포 때마다 자동 재생성됩니다.
// - 생성 결과는 .gitignore 대상이며 직접 수정하지 않습니다.
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sitesDir = join(root, 'sites')
const outPath = join(root, 'functions', '_lib', 'site-data.generated.js')

const siteIds = readdirSync(sitesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const data = {}
for (const siteId of siteIds) {
  const raw = readFileSync(join(sitesDir, siteId, 'hospital.json'), 'utf-8')
  data[siteId] = JSON.parse(raw) // JSON이 깨져 있으면 여기서 빌드가 실패 (조용한 오배포 방지)
}

const banner = [
  '// 자동 생성 파일 — 직접 수정 금지',
  '// 원천: sites/<siteId>/hospital.json (scripts/generate-writer-site-data.mjs가 빌드 시 생성)',
  '',
].join('\n')

mkdirSync(join(root, 'functions', '_lib'), { recursive: true })
writeFileSync(outPath, `${banner}export const SITE_DATA = ${JSON.stringify(data, null, 2)}\n`, 'utf-8')
console.log(`✔ functions/_lib/site-data.generated.js 생성 완료 (사이트: ${siteIds.join(', ')})`)
