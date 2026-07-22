# Domain Wizard (Phase 14C)

병원별 배포 도메인을 등록·안내·검증하고, Phase 15 Deploy Engine이 사용할
**배포 준비 상태(deploy_ready)** 를 만드는 내부 운영 도구입니다.

원칙: 도메인 자동 구매 없음 · **무단 DNS 변경 없음(검증은 전부 읽기 전용)** ·
API Token 없이 Manual Mode만으로 완전히 사용 가능 · 민감한 비밀번호/인증
코드는 저장하지 않음.

## 운영 방식별 연결 방식

| 모드 | 예시 | 안내 |
|---|---|---|
| independent | seo-hospital.com | 신규 도메인 → Cloudflare 연결 → Pages Custom Domain → DNS·HTTPS 검증 |
| replace | hospital.com | **위험 경고 배너** + 변경 전 기존 레코드 백업 안내(INFO 행) + "전환 승인" 체크 필수. 최종 전환은 별도 확인 후 직접 실행 |
| subdomain | info.hospital.com | 서브도메인 CNAME 안내 → DNS 검증 → Pages Custom Domain 확인 |

도메인 구조가 모드와 맞지 않으면 경고합니다(예: independent인데 기존 홈페이지와
같은 도메인, subdomain 모드인데 apex 입력, replace인데 전혀 다른 도메인).
**기존 공식 홈페이지(existing_url)는 Import 수집 출처, 여기 등록하는 도메인은
새 SEO 사이트의 배포 대상** — UI에 명시해 혼동을 막습니다.

## Manual Mode 절차 (기본)

1. 온보딩 탭 → [도메인] → 도메인 입력·관리 주체 저장 (미정 선택 가능)
2. 화면의 DNS 안내 표(Type/Name/Target/Proxy/TTL)를 복사해
   Cloudflare Dashboard(DNS)와 Pages → Custom domains에 직접 등록
3. [검증 실행] — DNS 조회 → HTTPS 응답 → Pages 상태 확인 (읽기 전용)
4. 전파 대기(pending)면 시간을 두고 [다시 검증]
5. verified가 되면 [배포 준비 확인]으로 deploy_ready 확인

## API Mode 조건·환경변수

`CLOUDFLARE_API_TOKEN`(Pages:Edit 최소 권한) + `CLOUDFLARE_ACCOUNT_ID` +
`CLOUDFLARE_PAGES_PROJECT` 세 개가 모두 있으면 [Pages에 연결] 버튼이 활성화
됩니다(Custom Domain 조회·추가만 — 삭제·DNS 변경 없음, 실행은 항상 버튼
클릭 시). 토큰은 UI·DB·로그에 노출되지 않으며, API 실패 시 Manual Mode
안내로 전환됩니다.

DNS 안내의 연결 대상은 하드코딩하지 않습니다:
`DOMAIN_PAGES_HOST` (직접 지정) 또는 `CLOUDFLARE_PAGES_PROJECT` →
`<project>.pages.dev`. 미설정 시 자리표시자로 안내되고 자동 비교는
"수동 확인 필요"가 됩니다. 테스트 전용: `DNS_DOH_URL`,
`DOMAIN_CHECK_BASE_URL`, `CF_API_URL` (실서버 미설정).

## DNS 레코드 예시 (apex, Pages 프로젝트 = myproject)

| Type | Name | Target | Proxy | TTL |
|---|---|---|---|---|
| CNAME | @ | myproject.pages.dev | Proxied 권장 | Auto |
| CNAME | www | myproject.pages.dev | Proxied 권장 | Auto |

Cloudflare DNS는 apex에서도 CNAME 사용 가능(CNAME Flattening). 타 DNS
사용 시 네임서버 이전 또는 ALIAS/ANAME 필요. replace 모드는 여기에
"(변경 전 기록) 기존 레코드 백업" INFO 행이 추가됩니다.

## 검증 상태 의미

미입력 → 입력 완료 → DNS 안내 준비됨 → **DNS 대기**(레코드 미조회 — 전파
수 분~수 시간, 오류 아님) / **DNS 불일치**(다른 대상을 가리킴) / **수동 확인
필요**(A 레코드만 조회 — 프록시·플래트닝 가능성, 또는 Pages 대상 미설정) →
**HTTPS 대기**(인증서 발급·연결 전) → Pages 연결 대기 → **연결 완료(verified)**
/ 오류. 단일 실패를 확정 오류로 처리하지 않고 pending으로 둡니다.

진행률(연결 상태 기반, 각 20%): 도메인 입력 / 관리 주체 확인 / DNS 기대값
생성 / DNS 검증 / HTTPS·Pages 확인.

## deploy_ready 판정

유효한 도메인 + DNS 검증 ok + HTTPS ok(최종 도착지가 등록 도메인 —
매핑 확인) + replace 모드는 replacement_approved 체크. 미충족 사유는
readiness API가 목록으로 반환합니다.

## replace 모드 주의·롤백 절차

전환 전: 기존 DNS 레코드(Type/Name/Value) 전체를 기록(백업). 전환 후 장애
발생 시: 기록해 둔 기존 레코드로 되돌리면 기존 홈페이지가 복구됩니다
(TTL에 따라 수 분~수 시간). 시스템은 DNS를 변경하지 않으므로 롤백도 DNS
관리 화면에서 직접 수행합니다. replacement_approved 체크 전에는
deploy_ready가 되지 않습니다.

## DB (migration 0007 — 실서버 적용 필요)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0007_create_domain_connections.sql --remote
```

domain_connections: site_id별 활성 도메인 1행(active=1), 새 도메인 저장 시
이전 행은 비활성으로 보존(이력). 같은 도메인의 타 사이트 중복 등록 차단.
온보딩 new_domain/domain_status는 저장 시 자동 동기화(하위 호환), 온보딩
작업 체크 "도메인"은 **verified일 때만 완료로 올림**(직원 수동 체크를 내리지
않음).

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/domains | 전체 활성 도메인 현황 (운영·Phase 15) |
| GET/PUT | /api/domains/[site] | 설정 조회·저장 (미정 저장 가능) |
| POST | /api/domains/[site]/verify | 검증 실행 (읽기 전용) |
| POST | /api/domains/[site]/connect | Pages Custom Domain 추가 (API Mode 전용, 명시적 실행) |
| GET | /api/domains/[site]/readiness | Phase 15용 배포 준비 데이터 |

## Phase 15 연결 데이터 (readiness 응답)

siteId, targetDomain, operationMode, deployReady, dnsStatus, httpsStatus,
pagesStatus, replacementApproved, validationErrors[], expectedRecords[],
lastVerifiedAt — Deploy Engine은 이 응답만으로 배포 가능 여부를 판단합니다.

## 테스트

전부 스텁 기반(실제 DNS·Cloudflare API 호출 없음): DoH 스텁, 도메인 응답
스텁(정상/리디렉션/루프/오류/대기), Cloudflare API 스텁 + sqlite(0001~0007).
