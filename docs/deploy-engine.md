# Deploy Engine (Phase 15)

병원 사이트의 배포 준비 확인 → 사전 검사 → 승인 → 배포 실행 → 상태 추적 →
**배포 후 검증** → 이력 관리 → 복구(rollback) 를 담당하는 내부 운영 도구입니다.

기존 배포 구조(공유 GitHub 저장소 + 사이트별 Cloudflare Pages 프로젝트,
push 시 자동 빌드)를 **그대로 유지**합니다. 배포 실행은 "지정 브랜치 최신
커밋으로 Pages 빌드 트리거"이며, 강제 push·branch history 변경·Direct
Upload 전환은 하지 않습니다.

## 배포 흐름

```
[배포] → GET /api/deployments/<site> (요약·이력·설정)
→ POST .../preflight (사전 검사 + 배포 계획·변경 요약)
→ POST /api/deployments/<site> (승인 검증 → Pages 빌드 트리거 또는 수동 안내)
→ GET .../status?id= (Pages 빌드 상태 추적 — 완료 신호만으로 success 처리 안 함)
→ POST .../verify (실제 URL 검증 → success / partial_success / failed 확정)
→ 실패 시 POST .../rollback (이전 성공 배포 정보 → 사유 입력 후 실행)
```

도메인 준비 판단은 Phase 14C와 동일 모듈(computeDeployReady)이 단일
기준입니다 — Deploy Engine에 별도 판정 규칙이 없습니다.

## Preview / Production / Replace

| | Preview | Production | Replace |
|---|---|---|---|
| 대상 | `<프로젝트>.pages.dev` (내부 검수용) | 운영 도메인 | 기존 홈페이지 도메인 |
| 조건 | 사이트 데이터 fail 없음 (도메인 검사 skipped) | 사전 검사 fail 0 + readiness 통과 + 확인 체크 + 승인자 | Production 조건 + 승인 5항목(병원 승인·DNS 백업·전환 일정·rollback 절차·중단 이해) + **대상 도메인 직접 입력** + replacement_approved |
| stage | 변경 없음 | 시작 시 deploy → 검증 성공 시 operating | 동일 |
| 주의 | 운영 도메인 미반영. 단, 공유 브랜치 빌드라 이미 도메인이 연결된 프로젝트에는 함께 반영됨(경고 표시) | 확인 대화상자 | 위험 경고 + 빨간 버튼 분리 |

## 사전 검사 기준 (functions/_lib/deploy-preflight.js — 순수 함수)

pass / warning / fail / skipped. **fail이 1개라도 있으면 Production/Replace
불가, warning은 배포 가능(목록 안내)** — 규칙은 이 모듈 한 곳에서 관리.
검사: hospital.json 읽기·파싱(fail), 병원명(fail), 소개·전화·주소(warning),
Entity 유효성(fail), 템플릿(fail), 내부 정보 분리 — 담당자 필드가 공개 파일에
있으면 fail, CTA·SEO 데이터·콘텐츠 수·온보딩 진행률(warning), 배포 번들
포함 여부(warning — 신규 사이트는 이번 빌드부터 포함), 도메인
readiness(production에서 fail), replace 승인(fail). 정적 빌드·check:seo는
Pages 빌드 파이프라인에서 실행되므로 skipped로 표시하고 배포 상태로 추적.

계획 미리보기: 현재 배포 번들 vs GitHub 원본의 데이터 수준 diff
(hospital.json 변경 필드, 의료진·진료과 증감, 템플릿·이미지·Schema 변경,
콘텐츠 수) + 최근 Import 적용 + 배포 후 예상 작업.

## 배포 상태 의미

queued → validating → building(빌드) → deploying → **verifying(빌드 완료 —
검증 대기, 자동 성공 아님)** → success / partial_success(보조 항목 미확인) /
failed / cancelled / rolled_back. 전이는 조건부 UPDATE(낙관적 잠금)이며,
같은 사이트의 진행 중 배포가 있으면 409(30분 초과 시 지연으로 간주).

## 배포 후 검증 (functions/_lib/deploy-verify.js)

실제 URL을 검사: 대표 페이지 200·HTTPS·최종 도메인 일치·redirect 확인,
title 존재, **병원명 일치(다른 사이트 표시 감지 — SITE env 오설정 방지)**,
canonical 일치(Preview는 운영 도메인 canonical 정상 처리), noindex 오설정,
robots.txt 전체 차단, sitemap.xml, Schema(JSON-LD), CTA 링크.
심각 항목 실패 → failed / 보조 항목(sitemap·Schema·CTA) 미확인 →
partial_success / 전부 통과 → success.

## Rollback (보수적)

자동 rollback 없음. [Rollback] → 직전 성공 배포 정보(시각·커밋 sha·Pages
배포 id)와 수동 복구 절차를 먼저 표시 → **사유 입력 + 확인 후에만**
Cloudflare Pages rollback API 실행(rolled_back 기록). API Token이 없거나
이전 기록이 없으면 실행하지 않고 수동 절차(Dashboard rollback / git revert)
안내. replace 모드는 추가로 기존 운영 URL·DNS 백업 메모·DNS 복구 3단계를
표시합니다.

## 환경변수·권한

필수(기존): GITHUB_TOKEN(Contents RW — 기존 게시와 동일), ANTHROPIC_API_KEY 등.
자동 배포(API Mode) 선택: `CLOUDFLARE_API_TOKEN`(Pages:Edit),
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`. 없으면 자동 트리거·
rollback 실행이 비활성화되고 수동 배포 안내(Manual Mode)로 완전 동작.
사이트별 프로젝트는 배포 설정(site_deploy_config: pages_project/branch/
strategy)으로 연결(자동 프로젝트 생성 없음 — 수동 연결 방식).
테스트 전용: CF_API_URL, DEPLOY_VERIFY_BASE_URL, GITHUB_API_URL.

## DB (migration 0008 — 실서버 적용 필요)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0008_create_deploy_jobs.sql --remote
```

deploy_jobs(이력·결과 JSON·승인자·오류 코드) + site_deploy_config.
민감 토큰은 저장하지 않습니다.

## 운영 장애 대응

빌드 실패 → Cloudflare 빌드 로그 확인 후 수정·재배포. 검증 failed(다른
사이트 표시) → 프로젝트 SITE env·도메인 연결 즉시 확인. HTTPS 미발급 →
도메인 탭 재검증(인증서 대기). replace 장애 → 기록해 둔 기존 DNS 레코드로
복원(도메인 문서의 롤백 절차). 모든 실패는 오류 코드 + 다음 행동 안내와
함께 이력에 남습니다.

## Phase 16 (SEO Operation) 연결 데이터

- `GET /api/deployments` / `GET /api/deployments/<site>`: 사이트별 배포
  상태·마지막 성공·운영 URL — 운영 대상(stage=operating) 선정 기준
- onboarding.stage가 operating인 사이트 = SEO 운영 루프 대상
- verification_result(canonical·sitemap·robots 상태)는 SEO 점검의 초기값
