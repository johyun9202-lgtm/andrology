#!/usr/bin/env node
// ============================================================
// SEO 사전 검사 실행 스크립트
//
// 실행: npm run check:seo  (npm run build 시 자동 실행)
//
// - SITE 환경변수로 검사 대상 사이트를 선택합니다 (없으면 andrology)
// - 검사 규칙은 scripts/lib/seo-checker.mjs 한 곳에서만 관리됩니다.
// - 오류(✕)가 있으면 exit 1 → 빌드 중단
// - 경고(⚠)만 있으면 exit 0 → 빌드 계속
// ============================================================

import { runSeoCheck, red } from './lib/seo-checker.mjs'

// 검사 대상 사이트 데이터 로드 (site-data.js와 동일 원천)
let hospital
let siteId
try {
  const mod = await import('../src/lib/site-data.js')
  hospital = mod.siteData
  siteId = mod.siteId
} catch (e) {
  console.error(`✕ ${e.message}`)
  process.exit(1)
}

const result = runSeoCheck(hospital, siteId, { print: true })

if (result.errors.length > 0) {
  console.error(red('SEO 필수 항목 오류로 빌드를 중단합니다. 위 ✕ 항목을 수정해 주세요.'))
  process.exit(1)
}
process.exit(0)
