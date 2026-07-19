// 공통 사이트 데이터 로더 (Multi Site)
//
// 모든 페이지와 컴포넌트는 반드시 이 파일을 통해서만 사이트 데이터를 가져옵니다.
// 데이터 파일의 실제 위치(sites/<사이트ID>/hospital.json)를 아는 곳은 이 파일 하나뿐입니다.
//
// - SITE 환경변수로 사이트를 선택합니다 (없으면 andrology)
// - Astro 빌드(정적 생성), astro.config.mjs, Node 검사 스크립트
//   세 환경 모두 빌드 시점의 Node에서 실행되므로 fs로 읽는 방식이
//   가장 단순하고, Vite의 "문자열 경로 동적 import 불가" 제약도 피할 수 있습니다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSiteId } from './site-id.js'

export const siteId = getSiteId()

// 프로젝트 루트(빌드 실행 위치) 기준으로 읽습니다.
// 빌드 과정에서 코드가 다른 위치로 묶여 실행되어도 경로가 어긋나지 않습니다.
const dataFilePath = join(process.cwd(), 'sites', siteId, 'hospital.json')

let rawJson
try {
  rawJson = readFileSync(dataFilePath, 'utf-8')
} catch {
  throw new Error(
    `[SITE 오류] 사이트 "${siteId}"의 데이터 파일이 없습니다: sites/${siteId}/hospital.json ` +
      '— 폴더 이름과 SITE 값이 일치하는지 확인해 주세요.'
  )
}

let parsed
try {
  parsed = JSON.parse(rawJson)
} catch (e) {
  throw new Error(
    `[SITE 오류] sites/${siteId}/hospital.json이 올바른 JSON이 아닙니다: ${e.message}`
  )
}

export const siteData = parsed
