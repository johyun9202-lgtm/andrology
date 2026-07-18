// 공통 사이트 데이터 로더
//
// 모든 페이지와 컴포넌트는 반드시 이 파일을 통해서만 사이트 데이터를 가져옵니다.
// 데이터 파일의 실제 위치를 아는 곳은 이 파일 하나뿐입니다.
//
// 향후 멀티 사이트 전환 시(sites/업체/site.json + SITE 환경변수),
// 아래 import 부분만 바꾸면 나머지 코드는 수정 없이 그대로 동작합니다.

import hospital from '../data/hospital.json'

export const siteData = hospital
