# Hospital Import Engine (Phase 14B)

병원의 기존 홈페이지를 제한적으로 수집해 새 SEO 홍보사이트 제작에 필요한
정보를 빠르게 모으는 **내부 운영 도구**입니다. 수집 결과는 절대 자동으로
공개 사이트에 반영되지 않으며, 반드시 **수집 → 검토 → 선택 적용** 절차를
거칩니다. (Phase 12의 "생성 → 검토 → 적용" 구조와 동일한 원칙)

## 데이터 흐름

```
온보딩 existing_url(또는 직접 입력)
→ POST /api/import: robots 확인 → 메인 + 우선 내부 페이지 제한 수집
→ 후보 추출(출처·근거 포함) + Import Score → D1 import_jobs에 원본 기록
→ Dashboard 온보딩 탭 [Import] 검토 화면: 상태·충돌·출처 확인, 값 수정, 항목 선택
→ POST /api/import/apply: 선택 항목만 검증 → hospital.json 병합 → GitHub 커밋
→ import_jobs에 적용 이력 기록 → 재배포 후 사이트 반영
```

## 크롤링 범위와 제한 (functions/_lib/import-crawler.js)

- 같은 도메인만(www 유무 무시), 외부 도메인 리디렉션 페이지는 실패 처리
- SSRF 가드: 내부망·사설 IP·localhost·비표준 포트 차단 (import-html.js)
- robots.txt User-agent:* Disallow 존중 (전체 차단 시 Import 실패로 안내)
- 최대 페이지: `IMPORT_MAX_PAGES` (기본 8, 상한 15) / 페이지당 timeout
  `IMPORT_TIMEOUT_MS` (기본 8초) / 전체 예산 `IMPORT_BUDGET_MS` (기본 40초)
- 우선 탐색: 의료진 → 소개 → 진료과목/시술 → 진료시간 → 오시는 길 → 예약
  → FAQ → 시설 (메인 페이지 링크 텍스트·URL 기준)
- URL 정규화: fragment 제거, utm 등 추적 파라미터 제거, query 정렬 → 중복 방문 방지
- HTML만 처리(페이지당 1.5MB 제한), User-Agent `aiseolab-import-bot/1.0`
- 일부 페이지 실패 시 `partial_success` — 실패 페이지와 사유를 목록으로 표시
- JS 렌더링 사이트(본문 텍스트가 거의 없음)는 경고로 안내

## 추출 원칙 (functions/_lib/import-extractor.js)

- **사이트에 실제로 존재하는 값만** 추출 — 추측·생성 금지, AI 문구 생성 없음
- 모든 후보에 `sourceUrl`(출처 페이지)과 `sourceText`(근거) 저장
- confidence: high(JSON-LD·meta 명시) / medium(패턴) / low(휴리스틱)
- 수집 필드: 병원명·소개·전화(tel:/JSON-LD/본문)·주소·진료시간(평일/토/일·휴진),
  예약/지도/카카오 URL, 진료과목·시술 후보, FAQ(JSON-LD FAQPage),
  의료진(JSON-LD Person, 이미지 alt·헤딩 패턴), 로고/대표(og:image)/시설 이미지,
  SNS·블로그, 개인정보처리방침·이용약관, 진료 상세 페이지 URL

## Import Score (functions/_lib/import-score.js — 순수 함수)

발견 개수가 아니라 **가중치 합산**: 핵심(각 12점) 병원명·전화·주소·진료시간·
진료과목·의료진 = 72점 / 보조 예약 URL 5, 소개 5, 지도 4, FAQ 4, 로고 4,
의료진 사진 3, 시설 사진 3 = 28점 (합 100). 진료시간은 평일/토/일 중 발견
비율만큼 부분 점수. 미발견 항목은 그대로 **"추가로 필요한 자료"** 목록이 되어
직원이 병원에 요청할 자료로 표시됩니다(존재 여부 추측 없음).

## 충돌·병합 방식 (functions/_lib/import-apply.js)

- 검토 화면 상태: 발견(기존 값 없음) / 동일(적용 불필요) / **충돌(기존 값과
  다름 — 체크 기본 해제, 명시적으로 선택해야만 덮어씀)** / 누락 / 적용 완료
- `selections`에 담긴 필드만 변경, 나머지 전부 보존(deep copy 후 선택 필드만)
- 적용 가능: 병원명·소개·전화·주소·진료시간 3필드·예약/지도/카카오 URL·
  로고/대표 이미지·FAQ(교체)·의료진(Entity doctors[]에 **추가**, slug 자동
  doctor-N, validateEntities로 정합성 보장 — 약력 등은 엔티티 탭에서 입력)
- 참고용(자동 적용 없음): 진료과목·시술 후보(설명 문구가 필요해 설정 탭에서
  입력), 시설 사진, SNS, 진료 상세 페이지, 약관류
- sha 낙관적 잠금(409), 검증 실패 시 아무것도 적용하지 않음
- 커밋 메시지: `Apply import: <site> (<적용 필드>)`

## DB (migration 0006 — 실서버 적용 필요)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0006_create_import_jobs.sql --remote
```

import_jobs: id(imp_uuid), site_id, source_url, status(running|completed|
partial_success|failed), pages_scanned/failed, score, result(JSON: candidates/
pages/score/missing/warning), error_message, applied_at/applied_fields(적용 이력),
started/completed/created_at + site 인덱스. 재실행 시 과거 기록이 유지되며
GET이 최근 5건 이력을 함께 반환합니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/import?site= | 최신 Import(전체 결과) + 이력 5건 + 기본 sourceUrl |
| POST | /api/import | `{site, sourceUrl?}` — 수집 실행·기록 (sourceUrl 생략 시 온보딩 existing_url) |
| POST | /api/import/apply | `{site, importId, sha, selections}` — 선택 항목만 병합·커밋 |

관리자 인증 필수, medical 템플릿 사이트만, importId의 site_id 일치 검사
(다른 사이트 기록으로 적용 불가), prepared statement만 사용.

## 알려진 한계

- 정적 HTML 기준 — JS 렌더링(SPA) 사이트는 추출이 거의 안 되며 경고로 안내
  (브라우저 자동화 도구는 무겁고 Workers에서 실행 불가라 채택하지 않음)
- 진료시간·주소·의료진의 패턴 추출은 사이트 구조에 따라 누락될 수 있음 —
  그래서 모든 값은 출처와 함께 검토 화면을 거치고, 누락은 요청 목록으로 표시
- 이미지 URL은 원본 사이트 주소 그대로 수집 (다운로드·R2 업로드는 향후)
- 외부 라이브러리 추가 없음 (정규식 기반 경량 파서 — Workers·Node 양쪽 동작)

## Phase 14C(Domain Wizard) 연결 지점

- 온보딩 `new_domain`/`domain_status`와 Import 완료 상태를 함께 보여주는 것이
  자연스러운 다음 단계 (stage: onboarding → import → domain 전이)
- Import 검토 화면과 같은 패널 패턴(온보딩 탭 내 패널)을 재사용하면 됨

## 테스트

전부 스텁·fixture 기반 (실제 외부 병원 홈페이지에 요청하지 않음):
가짜 병원 사이트 스텁(정상/robots 차단/404/JS 렌더링/외부 리디렉션 모드) +
GitHub 스텁 + sqlite(migration 0001~0006). 단위(URL·전화·시간·JSON-LD·중복·
점수·충돌·적용) + API + Playwright UI + 전체 회귀.
