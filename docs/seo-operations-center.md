# AI SEO Operations Center (Phase 16)

배포 완료된 병원 사이트를 지속 점검하고, SEO 문제·콘텐츠 부족·운영 장애를
찾아 **오늘 할 일**로 바꾸는 내부 운영 센터입니다. 운영자가 아침에 이 탭
하나만 보고 우선순위를 판단하는 것이 목적입니다.

원칙: 검색순위·검색량·경쟁도 등 **실측 없는 값은 표시하지 않습니다**
(콘텐츠 기회는 "내부 데이터 기준"으로 명시). AI·시스템이 콘텐츠를 자동
공개·자동 배포하는 경로는 없습니다 — 모든 변경은 기존
발견 → 제안 → 검토 → 적용 → 배포 절차를 그대로 사용합니다.

## 운영 대상 사이트 기준 (seo-status.js — 순수 함수)

점검 가능(checkable): stage=operating + 활성 도메인 + 성공한
Production/Replace 배포. stage=error도 원인 확인용으로 점검 가능.
paused(설정 또는 stage)·운영 전(deploy/domain_pending/not_operating)
사이트는 목록에 별도 상태로 표시하되 점검에서 제외합니다.

## 점검 영역 (functions/_lib/seo-rules.js — Registry)

규칙 1개 = 배열 항목 1개(입출력 형태 통일)로, 추가는 항목 1개만 쓰면
됩니다. Technical(응답·HTTPS·병원명 일치·noindex·robots·canonical·sitemap·
title/description·H1·viewport·이미지 alt·깨진 내부 링크·페이지 크기),
Content(콘텐츠 수·발행 주기·본문 분량·기본 정보·의료진·FAQ + 내부 콘텐츠
기회 2종), Entity(Schema·엔티티 연결·화면-데이터 일관성),
Conversion(전화/예약/지도 CTA·예약 URL 응답), Operations(배포 상태·도메인
DNS/HTTPS·만료 예정·Import 누락·온보딩 잔여). HTML 파싱은 Phase 14B
import-html 모듈, 데이터는 배포 번들·도메인·배포·Import 기록을 재사용해
같은 규칙을 중복 구현하지 않습니다.

점검 범위 제한: 대표 페이지 + sitemap의 우선순위 페이지만
(SEO_CHECK_MAX_PAGES 기본 6, 상한 12 / 페이지당 SEO_CHECK_PAGE_TIMEOUT_MS
8초 / 전체 SEO_CHECK_TOTAL_TIMEOUT_MS 40초 / SEO_CHECK_STALE_DAYS 60 /
SEO_CONTENT_MIN_WORDS 300). 내부 링크는 표본 5개, 외부 링크(예약 URL)는
존재 확인 1건만 — 무제한 크롤링 없음.

## Health Score (seo-score.js — 순수 함수)

100 = Technical 30 + Content 25 + Entity 20 + Conversion 15 + Operations 10.
규칙별 가중치로 감점(fail 전액, warning 절반). 치명 항목(접속 불가·다른
병원 표시·noindex·robots 전체 차단·CTA 전무)은 **전체 점수 상한 20**.
등급: 90+ healthy / 75+ good / 60+ warning / 그 외 critical.

## severity·priority

severity: critical/high/medium/low/info. priority = severity 기본점
(100/70/40/20/5) + 사이트 전체 영향 +15 + 전환 영향 +10 + 최근 배포 직후
+10 + 방치 1일당 +1(최대 15). 오늘의 할 일은 priority 내림차순 +
병원별 최대 3개(쏠림 방지)로 표시합니다.

## finding 중복 처리

fingerprint = `site:rule:경로`(도메인 무관). 반복 점검에서 같은 문제는
기존 finding의 last_detected를 갱신(새 행 없음), resolved였다가 재발하면
**reopened**, ignored는 다시 열지 않습니다. 이번 점검에서 실제 평가된
규칙이 더 이상 문제를 찾지 못하면 resolved 확정(평가 안 된 규칙은 판정
보류). 작업(task)은 finding당 1건으로 동기화되며, 직원이 완료 표시한
작업이 다음 점검에서 다시 발견되면 "완료 표시했으나 다시 발견됨"과 함께
자동 reopened, 해결이 확인되면 자동 완료 처리됩니다.
critical 작업 무시는 사유 입력이 필수입니다.

## Action Center 사용법

오늘의 할 일 → [이동](관련 탭: 온보딩/Import/도메인/배포/엔티티/설정/생성) →
수정 → [완료](메모) → 다음 점검이 해결을 확정. 콘텐츠 작성은 기존 생성
작업 탭(AI Writer)으로 연결되며, AI 초안 역시 검토 후 게시 절차를 거칩니다
(자동 공개 없음). 규칙 기반 점검은 AI 설정 없이 완전 동작합니다.

## 수동·정기 점검

수동: 병원별 [지금 점검], 전체 [전체 점검](순차 batch — 호출 1회당
SEO_CHECK_BATCH 기본 3개, 마지막 점검 오래된 순, 개별 실패가 batch를
중단하지 않음, 실행 중 중복 409). 정기: 스케줄러(Cron Worker 등)가
`POST /api/seo-operations/run-all`을 주기 호출하면 됩니다 — Pages Functions
단독으로는 Cron Trigger를 걸 수 없어 이번 Phase는 구조만 준비했습니다
(별도 Worker 1개 또는 외부 스케줄러로 연결).

## Post-deploy 연동

`POST /api/seo-operations/run`에 `triggerType: "post_deploy"`로 호출하면
전파 민감 항목(sitemap·DNS)은 fail 대신 warning + "전파 지연 가능" 안내로
처리합니다(즉시 실패 단정 금지). 배포 검증 성공 후 이 호출을 붙이는 것이
연결 지점입니다.

## API

GET /api/seo-operations(현황판) · GET/PUT /api/seo-operations/[site]
(상세/설정) · POST run · POST run-all · GET tasks(필터·perSiteCap) ·
PUT tasks/[id](상태 전이 서버 검증). 전부 관리자 인증·prepared
statement·site_id 분리·결과 크기 제한.

## DB (migration 0009 — 실서버 적용 필요)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0009_create_seo_operations.sql --remote
```

seo_check_runs / seo_findings(fingerprint unique) / seo_tasks /
site_seo_settings. 원본 HTML 전체·민감정보는 저장하지 않습니다.

## 오류 대응

점검 실패(운영 URL 없음·접속 실패·robots 차단 등)는 오류 코드 + 다음
행동 안내와 함께 기록되며, 접속 실패 사이트는 점수 상한 20 + critical
작업으로 즉시 오늘의 할 일 최상단에 올라옵니다.

## 향후 Search Console·Analytics 연동 지점

검색량·순위·클릭 데이터는 이번 Phase에 없습니다. 연동 시 seo_findings에
새 category(예: search-performance) 규칙을 Registry에 추가하고, 콘텐츠
기회 규칙의 근거를 내부 데이터 → 실측 데이터로 교체하면 됩니다. 점수·작업·
현황판 구조는 그대로 재사용됩니다.
