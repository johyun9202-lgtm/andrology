# Client Onboarding Engine (Phase 14A)

병원 계약 후 **직원이 5~10분 안에 새 병원 프로젝트를 생성**하기 위한
내부 운영 시스템입니다. 병원이 쓰는 CMS가 아니라, 우리 회사가 병원을
관리하는 AI SEO 운영 도구입니다. 기존 Site Creation Wizard(Phase 11)를
확장했으며, Import Engine(14B)·Domain Wizard(14C)·Deploy Engine(15)·
SEO Operation(16)이 이 구조 위에 붙습니다.

## 저장 구조 — 왜 D1인가

온보딩 정보는 저장소(hospital.json)가 아닌 **D1 `site_onboarding` 테이블**에
저장합니다 (migrations/0005_create_site_onboarding.sql).

- 담당자 이름·연락처·이메일은 **내부 운영 정보**라 사이트 빌드 데이터와 분리
- 새로 생성한 사이트는 재배포 전에는 빌드 번들(allowlist)에 없지만,
  D1 기준이므로 생성 즉시 온보딩 탭에서 조회·진행률 표시 가능
- 이후 Phase의 상태 전이(stage: onboarding → import → domain → deploy →
  operating)를 jobs 테이블과 같은 패턴으로 확장 가능

단, 전환정보(전화·예약·네이버지도·카카오채널)는 사이트에도 필요한 값이므로
생성 시 초기 hospital.json(phone, channels.naverBooking/naverMap/kakao)에도
반영됩니다. 이후 수정은 기존처럼 "사이트 설정" 탭에서 합니다(이중 관리 아님 —
온보딩 테이블은 계약·진행 관리용 기록).

## 온보딩 항목 (마법사 6단계)

| 단계 | 항목 |
|---|---|
| 1 기본정보 | 병원명(=사이트 이름)*, 담당자, 연락처, 이메일 |
| 2 업종·siteId | 템플릿 선택 + siteId* |
| 3 운영방식 | 독립 SEO 홍보사이트(기본) / 기존 홈페이지 교체 / 서브도메인 운영 + 기존 홈페이지 URL |
| 4 전환정보 | 예약 URL, 전화번호, 네이버지도 URL, 카카오채널 URL |
| 5 새 도메인 | 입력 또는 "미정" 선택 (미정 기본) |
| 6 작업체크 | 로고/사진/예약링크/지도/전화/도메인 준비 완료 여부 + 요약·생성 |

검증은 서버 `functions/_lib/onboarding.js`가 단일 기준입니다
(URL은 http/https만, 이메일·전화·도메인 형식, 운영방식 enum, 제어문자 제거).

## Dashboard — 온보딩 탭

병원별 목록(병원명·siteId·담당자·운영방식·**진행률 막대+%**)과 [관리] 편집
폼(6개 섹션 전체 수정 + 작업 체크 저장)을 제공합니다.
진행률 = 작업 체크 완료 수 ÷ 6 (반올림 %). 100%가 되면 막대가 녹색으로
바뀝니다. 항목 정의는 `CHECKLIST_ITEMS` 한 곳(서버)에서 관리하며 API가
라벨을 함께 내려줍니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/onboarding | 전체 목록 + 진행률 + 라벨 메타 |
| GET | /api/onboarding/&lt;siteId&gt; | 개별 조회 (없으면 404) |
| PUT | /api/onboarding/&lt;siteId&gt; | 검증 후 수정. 레코드가 없어도 기존 사이트(allowlist)거나 저장소에 실재하는 사이트면 생성(upsert) |
| POST | /api/sites | (확장) body.onboarding이 있으면 커밋 전에 검증하고, 사이트 생성 후 D1에 온보딩 레코드 저장. D1 실패 시 사이트는 유지하고 `onboardingSaved:false`로 알림 → 온보딩 탭에서 재저장 |

모두 관리자 인증 필수, prepared statement만 사용, Secret 미노출.

## DB (migration 0005 — 실서버 적용 필요)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0005_create_site_onboarding.sql --remote
```

site_onboarding: site_id(PK), hospital_name, manager_name/phone/email,
operation_mode(independent|replace|subdomain), existing_url,
reservation_url/phone/naver_map_url/kakao_channel_url,
new_domain + domain_status(undecided|decided), checklist(JSON),
stage(기본 'onboarding'), created_at/updated_at, stage 인덱스.

## 다음 Phase 연결 지점 (구조만 준비됨)

- **14B Hospital Import Engine**: `existing_url`이 수집 대상.
  Import 결과 적용은 Phase 12의 "생성 → 검토 → site-settings merge 적용"
  구조를 재사용하면 되고, 완료 시 stage를 'import'로 전이
- **14C Domain Wizard**: `new_domain` + `domain_status`
  (undecided|decided → requested/connected/verified 확장 예정)
- **15 Deploy Engine**: stage 'deploy' + Cloudflare Pages 프로젝트 생성 자동화
- **16 SEO Operation**: stage 'operating' 병원 대상 운영 지표·작업 루프

stage 전이 로직은 이번 단계에 없습니다(모두 'onboarding' 고정) —
각 Phase가 자신의 완료 시점에 조건부 UPDATE로 전이시키는 것을 전제로 합니다.

## 테스트

- 검증·저장소·API: /tmp/test-onboarding.mjs (sqlite로 migration 0001~0005
  실행 + GitHub 스텁 — 실저장소·실API 호출 없음)
- UI: Playwright — 마법사 6단계 흐름, 온보딩 탭 목록·진행률·편집 저장
- 기존 test-sites.mjs는 onboarding 없이도 동작(하위 호환) 확인
