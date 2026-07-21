// 공통 사이트 데이터 로더 (Multi Site)
//
// 모든 페이지와 컴포넌트는 반드시 이 파일을 통해서만 사이트 데이터를 가져옵니다.
// 실제 로딩·병합 로직은 src/lib/load-hospital.js 한 곳에만 있습니다.
//
// - SITE 환경변수로 사이트를 선택합니다 (없으면 기본 사이트)
// - articles는 hospital.json 배열 + sites/<사이트ID>/articles/*.json 개별 파일이
//   병합된 결과입니다 (Phase 7.5 — 규칙·오류 처리는 load-hospital.js 참고)
// - Astro 빌드(정적 생성), astro.config.mjs, Node 검사 스크립트
//   세 환경 모두 빌드 시점의 Node에서 실행되므로 fs로 읽는 방식이
//   가장 단순하고, Vite의 "문자열 경로 동적 import 불가" 제약도 피할 수 있습니다.

import { getSiteId } from './site-id.js'
import { loadHospital } from './load-hospital.js'

export const siteId = getSiteId()

// 프로젝트 루트(빌드 실행 위치) 기준으로 읽습니다.
// 빌드 과정에서 코드가 다른 위치로 묶여 실행되어도 경로가 어긋나지 않습니다.
export const siteData = loadHospital(siteId)
