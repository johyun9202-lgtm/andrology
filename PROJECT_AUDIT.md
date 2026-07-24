# AI SEO Lab — 프로젝트 감사 보고서

- 최초 작성일: 2026-07-23 (읽기 전용 조사)
- **갱신일: 2026-07-24 — §0(작업 이력·Git 상태), §9(보안 항목 해결), §11/§12(결정 필요 사항 갱신), 요약표를 이번 세션 작업 반영해 업데이트. 나머지 섹션은 최초 작성 시점 조사 내용을 그대로 유지합니다.**
- 조사 방법: 코드 정적 분석(Read/Grep/Glob) + git 명령. 최초 작성은 100% 읽기 전용으로 진행했고, 이후 갱신분(§0/§9/§11/§12/요약표)은 실제로 완료된 코드 변경·커밋·병합 이력을 반영한 것입니다.
- 대상 저장소: `andrology` (Astro 7 + Cloudflare Pages Functions + Cloudflare D1 + GitHub Contents API 기반)
- 확인된 사실과 추정을 구분해 표기했습니다. 근거 없는 추측은 "추정"이라고 명시했고, 코드를 직접 읽고 확인한 내용만 "확인됨"으로 적었습니다.

---

## 0. 2026-07-23~24 작업 이력 및 현재 Git 상태 (신규)

이 감사 문서가 처음 작성된 시점 이후, §9에서 지적된 보안 위험 2건을 실제로 수정하고, 당시 76개 파일에 걸쳐 미커밋 상태였던 작업 전체를 기능 단위로 정리해 커밋했습니다. 그 과정에서 **이 세션과 무관한 다른 경로로 origin/main에 이미 반영된 커밋 3개**를 발견해 병합까지 완료했습니다. 아래는 그 경과와 현재 상태입니다.

**1) 미커밋 작업 정리 (13개 커밋)**

| 커밋 | 내용 |
|---|---|
| `cfc13ea` | 엔티티 SEO(진료과·의료진 CRUD + 공개 페이지) |
| `5b579e2` | 병원 온보딩 워크플로우 |
| `5ef4608` | 회사 홈페이지/병원 사이트 분리(`COMPANY_SITE`) + SaaS 랜딩페이지 재설계 |
| `4636815` | 병원 사이트 내부 미리보기 라우트(`/sites/<id>/`) |
| `f84f389` | Dashboard 7탭 개편 |
| `5dbd083` | Open Graph 이미지 메타 지원 |
| `bc535f0` | 이 감사 문서(PROJECT_AUDIT.md) 최초 버전 커밋 |
| `fc0c2d7`/`a7518fd`/`4cd8888`/`f06e5d1` | 병원 정보 임포트 / 도메인 연결 / 배포 엔진 / SEO 운영센터 |
| `2f03eee` | **§9-1 저장형 XSS 방어**(아래 상세) |
| `30fe5d0` | **§9-2 로그인 브루트포스 방어**(아래 상세) |

**2) origin/main 분기 발견 및 병합**

fetch 결과 origin/main에는 이 세션과 무관하게 이미 push된 커밋 3개(`062c300` Phase13-16 완성분, `a822081` aiseolab 설정 변경, `972238f` 회사/병원 분리 — Dashboard의 실제 운영 화면을 통해 저장된 것으로 추정)가 있었습니다. 대표님 확인 결과 `a822081`이 담고 있던 aiseolab(회사) 사이트의 전화번호("062-123-1234")·주소·원장명·"남성 전문 비뇨기과" 문구는 **테스트용 더미 데이터**였습니다.

두 이력을 전수 비교한 결과 70개 공통 변경 파일 중 65개는 완전히 동일했고, 실제로 내용이 다른 파일은 5개(`sites/aiseolab/hospital.json`, `src/pages/index.astro`, `functions/_lib/entities.js`, `src/layouts/BaseLayout.astro`, `src/pages/dashboard.astro`)뿐이었습니다. `git merge origin/main`(force push 없이, 양쪽 이력 보존)으로 병합했고, 대표님 지시에 따라 5개 파일 모두 **로컬 버전(SaaS 랜딩페이지 + 보안 수정 + Dashboard 개편)을 채택**했습니다(병합 커밋 `637df2c`). 병합 직후 두 사이트 빌드와 보안 회귀 테스트 24개를 재실행해 이상 없음을 확인했습니다. 이 병합 과정에서 사용한 백업 브랜치 `backup/pre-merge-local-main-20260724-0056`은 그대로 보존되어 있습니다.

**3) 현재 Git 상태 — 중요: 아직 GitHub에 반영되지 않음**

로컬 `main`은 `origin/main`보다 14개 커밋(위 13개 + 병합 커밋) 앞서 있으나, **이 작업 환경(클라우드 샌드박스)에 GitHub 쓰기 인증 수단이 구성되어 있지 않아 `git push`가 실패한 상태**입니다(SSH 클라이언트 미설치, HTTPS 자격증명 헬퍼 미구성). 즉 **아래 §9의 보안 수정을 포함해 이번에 정리된 모든 작업은 아직 실제 배포(Cloudflare Pages)에 반영되지 않았습니다.** push 인증 문제를 해결하고 push를 완료하기 전까지는 운영 중인 실제 사이트가 이 문서의 "해결됨" 표시와 다른(구버전) 상태일 수 있다는 점에 유의해야 합니다.

---

## 1. 프로젝트의 현재 목적

이 저장소는 하나의 코드베이스로 세 가지 역할을 동시에 수행합니다.

**① AI SEO Lab 회사 홈페이지** — `SITE=aiseolab`로 빌드될 때의 `/` 및 하위 공개 페이지(`/services`, `/articles`, `/faq`, `/contact`, `/privacy`). 일반 방문자에게 "AI SEO Lab이 어떤 서비스인지" 소개하는 SaaS 랜딩페이지 역할만 하며, 병원 콘텐츠는 노출되지 않습니다(`src/pages/index.astro`의 `isCompanySite` 분기로 구조적으로 분리됨).

**② 내부 운영 Dashboard** — `/dashboard`(+`/login`). 내부 운영자(대표님/팀)가 로그인해서 병원 사이트 생성·콘텐츠 생성·게시·SEO 점검·배포·도메인 연결까지 전 과정을 관리하는 관제탑입니다. 검색엔진에는 노출되지 않고(`noindex`), 세션 쿠키 인증이 모든 API에 적용됩니다.

**③ 병원별 SEO 사이트** — `sites/<siteId>/hospital.json`을 데이터 원천으로 하는 개별 병원 홈페이지. 각 병원은 자체 SITE 값으로 별도 빌드되어 실제 운영 도메인에 배포되는 것이 최종 목표이며, 회사 저장소 내부에서는 `/sites/<siteId>/`에서 비색인(noindex) 미리보기로 열람 가능합니다.

**연결 관계**: 셋 다 **같은 GitHub 저장소, 같은 Astro 코드베이스, 같은 Cloudflare D1 데이터베이스**를 공유합니다. `SITE` 환경변수가 "이번 빌드가 회사 사이트냐 어떤 병원 사이트냐"를 결정하고, Dashboard는 이 GitHub 저장소(`sites/*/hospital.json`)와 D1(운영 데이터: Job/온보딩/Import/도메인/배포/SEO)을 직접 조작하는 관리 도구입니다. 즉 Dashboard가 "본사"이고, 회사 홈페이지와 병원 사이트들은 Dashboard가 만들어내는 "산출물"이라는 구조입니다.

---

## 2. 전체 페이지 및 URL 목록

### 2-1. 프론트 페이지 (`src/pages/**`, 14개)

| URL 패턴 | 목적 | 대상 | 파일 경로 | 사용 데이터 | 인증 | 비고 |
|---|---|---|---|---|---|---|
| `/` | 홈페이지(회사 랜딩 또는 병원 홈) | 방문자 | `src/pages/index.astro` | site-data.js, templates.js, entity-schema.js | 불필요 | `isCompanySite` 분기로 한 파일이 완전히 다른 두 화면을 렌더링. 로직 복잡도 높음 |
| `/services` | 서비스/진료안내 목록 | 방문자 | `src/pages/services.astro` | site-data.js `services[]` | 불필요 | 정상 |
| `/articles` | 아티클(칼럼) 목록 | 방문자 | `src/pages/articles.astro` | site-data.js `articles[]` | 불필요 | 정상 |
| `/articles/{slug}/` | 아티클 상세 | 방문자 | `src/pages/articles/[slug].astro` | article(v1/v2 모델) | 불필요 | relatedArticles의 깨진 slug는 자동 필터링 |
| `/faq` | 자주 묻는 질문 | 방문자 | `src/pages/faq.astro` | site-data.js `faq[]` | 불필요 | 정상 |
| `/contact` | 상담문의 | 방문자 | `src/pages/contact.astro` | hospital.home/cta/channels | 불필요 | 정상 |
| `/departments/` | 진료과 목록(엔티티 있을 때만) | 방문자 | `src/pages/[entityList].astro` | `hospital.departments[]` | 불필요 | 데이터 없으면 페이지 자체 미생성(404) |
| `/doctors/` | 의료진 목록(엔티티 있을 때만) | 방문자 | `src/pages/[entityList].astro` | `hospital.doctors[]` | 불필요 | 동일 파일, 파라미터 분기 |
| `/departments/{slug}/` | 진료과 상세 | 방문자 | `src/pages/departments/[slug].astro` | department + 연관 doctors | 불필요 | JSON-LD 포함(§9 XSS 이슈 관련) |
| `/doctors/{slug}/` | 의료진 상세 | 방문자 | `src/pages/doctors/[slug].astro` | doctor + 연관 departments | 불필요 | JSON-LD 포함(§9 XSS 이슈 관련) |
| `/sites/{siteId}/` | 병원 사이트 내부 미리보기 | 관리자/내부 검수 | `src/pages/sites/[site].astro` | 해당 siteId의 hospital.json 직접 로드 | **없음**(noindex만) | 회사 빌드에서만 생성. URL을 알면 인증 없이 누구나 열람 가능 — 검색 노출만 차단된 상태 |
| `/login` | 관리자 로그인 | 관리자 | `src/pages/login.astro` | 없음(POST /api/auth/login 호출) | 불필요(로그인 자체) | noindex |
| `/dashboard` | 내부 운영 Dashboard | 관리자 | `src/pages/dashboard.astro` (4,684줄) | 거의 모든 API를 클라이언트 fetch | 필요(세션 쿠키, JS 가드) | HTML 셸 자체는 비로그인도 다운로드되지만 데이터는 각 API가 재검증 — 기능적으로는 안전. 파일 크기 자체가 유지보수 부담 |
| `/privacy` | 개인정보처리방침 | 방문자 | `src/pages/privacy.astro` | 없음(정적) | 불필요 | **"준비 중" 스텁 상태 — 실제 법적 내용 없음. noindex도 아니라서 빈 페이지가 검색 노출될 수 있음** |
| `/robots.txt` | robots.txt | 크롤러 | `src/pages/robots.txt.js` | config/site.js | 불필요 | 정상 |

### 2-2. API 엔드포인트 (`functions/api/**`, 33개 파일)

로그인/로그아웃/세션 조회를 제외한 **모든 API가 `isAuthenticated()` 세션 쿠키 검사를 통과해야 합니다**(코드 직접 확인).

| 메서드+경로 | 목적 | 파일 경로 | 데이터/외부 API | 비고 |
|---|---|---|---|---|
| POST `/api/auth/login` | 로그인, 세션 발급 | `auth/login.js` | ADMIN_PASSWORD/SESSION_SECRET | timing-safe 비교. D1 기반 브루트포스 방어(고정 윈도우 레이트리밋, §9-2) 구현됨 — **단, 아직 push되지 않아 실제 배포에는 미반영(§0-3)** |
| POST `/api/auth/logout` | 세션 만료 | `auth/logout.js` | 없음 | — |
| GET `/api/auth/session` | 로그인 여부 확인 | `auth/session.js` | 세션 쿠키 | — |
| GET/POST `/api/sites` | 사이트 목록 조회 / 새 병원 생성 | `sites.js` | D1 + GitHub 커밋 | 생성은 GitHub sha-없는 PUT으로 동시생성 충돌 자동 차단 |
| GET/PUT `/api/site-settings` | 병원(회사) 설정 조회/저장 | `site-settings.js` | GitHub Contents API | sha 낙관적 잠금, 저장 전 SEO 검사 필수(422), 회사 사이트는 `companyConfirmed` 별도 확인 |
| GET/PUT `/api/entities` | 진료과·의료진 조회/저장 | `entities.js` | GitHub Contents API | medical 템플릿만. 입력 블랙리스트를 제거하고 출력 단계(JSON-LD `safeJsonLdString()`)에서 이스케이프하는 방식으로 저장형 XSS 방어(§9-1) — **단, 아직 push되지 않아 실제 배포에는 미반영(§0-3)** |
| GET `/api/onboarding` | 전체 온보딩 목록 | `onboarding.js` | D1 | — |
| GET/PUT `/api/onboarding/:site` | 개별 온보딩 조회/저장 | `onboarding/[site].js` | D1 + GitHub(존재 확인) | allowlist 미등록 신규 사이트도 저장소 실존 시 허용 |
| GET/POST `/api/import` | Import 이력 조회 / 크롤링 실행 | `import.js` | D1 + 외부 URL 크롤링 | medical만. 관리자 인증 필요하지만 서버가 임의 외부 URL을 fetch하는 구조 |
| POST `/api/import/apply` | 검토된 Import 항목 반영 | `import/apply.js` | GitHub Contents API | sha 낙관적 잠금 |
| GET `/api/domains` | 전체 도메인 현황 | `domains.js` | D1 | — |
| GET/PUT `/api/domains/:site` | 도메인 설정 조회/저장 | `domains/[site].js` | D1 | 도메인 중복 등록 409 차단 |
| POST `/api/domains/:site/connect` | Cloudflare Custom Domain 추가 | `domains/[site]/connect.js` | Cloudflare Pages API | **추가만 있고 삭제/해제 API 없음(§8)** |
| GET `/api/domains/:site/readiness` | 배포 준비 상태 | `domains/[site]/readiness.js` | D1 | — |
| POST `/api/domains/:site/verify` | DNS/HTTPS 검증 실행 | `domains/[site]/verify.js` | DNS-over-HTTPS + HTTPS fetch | SSRF 가드(`isForbiddenTarget`) 적용 확인됨 |
| GET `/api/deployments` | 전체 배포 현황 | `deployments.js` | D1 | — |
| GET/POST/PUT `/api/deployments/:site` | 배포 이력 조회/생성/설정 저장 | `deployments/[site].js` | D1 + GitHub + Cloudflare Pages API | 승인 조건 서버 재검증, 중복 배포 409 |
| POST `/api/deployments/:site/preflight` | 배포 사전검사(13항목) | `deployments/[site]/preflight.js` | D1 | 안내용, 실제 배포시 서버가 재검사 |
| POST `/api/deployments/:site/rollback` | 이전 성공 배포로 복구 | `deployments/[site]/rollback.js` | D1 + Cloudflare Pages API | 사유 입력 필수, 자동 실행 없음 |
| GET `/api/deployments/:site/status` | 배포 상태 새로고침 | `deployments/[site]/status.js` | D1 + Cloudflare Pages API | — |
| POST `/api/deployments/:site/verify` | 배포 후 실제 URL 검증 | `deployments/[site]/verify.js` | 외부 fetch | host는 저장된 job/도메인 레코드에서만 파생(직접 SSRF 가드 재호출은 없으나 원본이 정규화된 값) |
| POST/GET/PUT `/api/jobs*` | AI 콘텐츠 생성 Job CRUD | `jobs.js`, `jobs/[id].js` | D1 | PATCH는 상태 화이트리스트만 허용 |
| GET/PUT/DELETE `/api/jobs/:id/article` | 게시된 글 조회/수정/삭제 | `jobs/[id]/article.js` | GitHub Contents API | sha 충돌 409 |
| POST `/api/jobs/:id/check-deployment` | 게시/삭제 반영 확인 | `jobs/[id]/check-deployment.js` | 외부 fetch(서버가 URL 조립) | SSRF 방지 주석 명시 및 확인됨 |
| POST `/api/jobs/:id/publish` | 초안 게시 | `jobs/[id]/publish.js` | GitHub Contents API | 원자적 상태 전이(`claimJobForPublish`)로 중복 게시 방지 |
| POST `/api/jobs/:id/run` | AI 초안 생성 실행 | `jobs/[id]/run.js` | **Anthropic API 실통신** | 원자적 상태 전이로 중복 실행 방지 |
| GET `/api/published-articles` | 게시된 글 목록(필터/페이지네이션) | `published-articles.js` | D1 | — |
| GET/PUT `/api/seo-operations*` | SEO 운영 현황/설정 | `seo-operations.js`, `seo-operations/[site].js` | D1 | — |
| POST `/api/seo-operations/run`, `/run-all` | SEO 점검 실행(개별/배치) | `seo-operations/run.js`, `run-all.js` | D1 + 대상 사이트 실제 fetch | `run-all`은 배치당 최대 N개(기본 3) — **정기 자동 호출 스케줄러 없음(§8)** |
| GET/PUT `/api/seo-operations/tasks*` | SEO 작업(할 일) 조회/상태 변경 | `seo-operations/tasks.js`, `tasks/[id].js` | D1 | critical 무시는 사유 필수 |
| POST `/api/site-content/generate` | AI 홈페이지 초안 생성(미저장) | `site-content/generate.js` | Anthropic API | 저장은 별도로 `/api/site-settings` 통해 사람이 승인 |

---

## 3. Dashboard 전체 구조

`src/pages/dashboard.astro` 단일 파일(HTML 447줄 + 전역 CSS 424줄 + Vanilla JS 약 3,800줄)로 구현. 세션 확인 실패 시 JS로 `/login` 리다이렉트, `innerHTML` 대신 `textContent` 기반 DOM 생성 원칙이 전역에 일관 적용되어 XSS 방어가 되어 있습니다(대시보드 내부 렌더링 한정 — §9의 공개 페이지 XSS와는 별개).

| 탭 | 실제 가능한 작업 | 연결 API |
|---|---|---|
| **홈** | 병원 목록을 진행단계(onboarding/import/domain/deploy/operating/error/paused)별로 요약 카드로 표시, 병원 클릭 시 워크스페이스 진입, 바로가기 3개(병원 관리/SEO 운영센터/온보딩) | `GET /api/sites` |
| **병원 사이트 관리** | 병원 목록 표시(회사 제외), 병원별 [설정]/[콘텐츠]/[미리보기]/[배포] 진입, "새 병원 사이트 만들기" 6단계 마법사(기본정보→업종/ID→운영방식→전환정보→도메인→체크리스트) | `GET/POST /api/sites` |
| **AI 콘텐츠 생성** | 워크스페이스 미지정 시 병원 선택 카드만 노출(사이트 선택 드롭다운 없음 — 요청하신 구조 반영됨). 지정 시 키워드로 아티클 생성 요청, 최근 작업 목록, 실행/게시 승인, "AI로 홈페이지 초안 만들기" | `POST/GET /api/jobs`, `POST /api/jobs/:id/run`, `POST /api/jobs/:id/publish`, `POST /api/site-content/generate` |
| **게시된 글** | 사이트/상태/배포상태/검색어 필터 + 페이지네이션, 배포 확인, 수정, 삭제 | `GET /api/published-articles`, `POST /api/jobs/:id/check-deployment`, `PUT/DELETE /api/jobs/:id/article` |
| **SEO 운영센터** | 전체 현황판 + 오늘의 할 일, 필터/정렬(클라이언트 처리), 전체/개별 점검 실행, 상세 패널에서 작업 완료/무시/재오픈, 점검 on/off 설정 | `GET /api/seo-operations`, `GET/POST /api/seo-operations/run(-all)`, `GET /api/seo-operations/:site`, `PUT /api/seo-operations/tasks/:id` |
| **온보딩** | 온보딩 정보 편집 + **Import/Domain Wizard/Deploy Engine 3개 패널이 이 탭 안에 내장**(별도 상단 탭이 아님) | `GET/PUT /api/onboarding/:site`, Import/Domains/Deployments 전체 API |
| **설정** | 병원(또는 회사) hospital.json 필드 편집, 진료 분야 동적 추가/삭제(1~10개) | `GET/PUT /api/site-settings` |

**숨겨진 8번째 화면(SEO 엔티티)**: `tab-entities` 섹션은 존재하지만 상단 탭 버튼(`tab-btn-entities`)이 없어 메인 내비게이션으로는 진입 불가능합니다. SEO 운영센터의 "진료과·의료진 관리 →" 버튼과 SEO 작업의 "entity" 이동 버튼, 이 두 경로로만 진입 가능합니다. 요청하신 7개 탭 구조에는 없어 의도된 설계로 보이나, 핵심 CRUD 화면이 메인 내비게이션 밖에 있다는 점은 기록해 둡니다.

**발견된 UX 비일관성** (코드 확인됨):
1. 워크스페이스(병원) 안에서 상단 "설정" 탭을 클릭하면 워크스페이스가 조용히 초기화되고 회사 설정으로 이동합니다. 다른 6개 탭 버튼은 워크스페이스를 유지합니다.
2. "설정" 탭 상단의 "AI로 홈페이지 초안 만들기 →" 버튼은 현재 보고 있는 병원과 무관하게 항상 회사 사이트를 대상으로 동작합니다("AI 콘텐츠 생성" 탭 안의 동일 기능 버튼은 올바르게 현재 워크스페이스를 따라감).
3. 온보딩 체크리스트의 "도메인" 체크 항목은 실제 Domain Wizard의 DNS/HTTPS 검증 결과와 자동 동기화되지 않는 별개의 수동 체크박스입니다.

---

## 4. 병원 사이트 관리 흐름

```
① 등록(POST /api/sites)                    [자동: GitHub 커밋]
   ※ 신규 사이트는 Cloudflare Pages 재빌드(1~2분) 전까지 다른 API에서 인식 못함
        ▼
② 온보딩(6단계 마법사 + 온보딩 탭)          [사람 입력 → D1 자동 저장]
        ▼
③ 데이터 저장/설정 편집                     [사람 입력 → 자동 GitHub 커밋 + SEO 사전검사]
        ▼ (선택) 기존 홈페이지가 있으면
④ Import(크롤링→후보 추출→사람 승인→적용)   [크롤링 자동, 적용은 사람 승인 필수]
        ▼
⑤ 미리보기(/sites/<id>/)                    [자동 생성이나 "다음 재빌드" 후에만 최신 반영 — 실시간 아님]
        ▼
⑥ 도메인 연결                               [사람이 도메인 입력 → DNS/HTTPS 자동 검증]
        ▼
⑦ 배포(Preview/Production/Replace)          [사람이 승인 클릭 필수, 서버 재검증 → 트리거는 자동/수동]
        ▼
⑧ 콘텐츠 생성 → ⑨ 게시                      [사람이 키워드 입력 → Claude API 자동 호출 → 사람이 검토 후 게시 클릭]
        ▼
⑩ SEO 운영(점검→findings→tasks)             [사람이 버튼 클릭 필수 — 정기 자동화 없음]
```

**단계별 구현 완성도**:

| 단계 | 상태 | 외부 통신 |
|---|---|---|
| ① 등록 | 완성 | GitHub API 실통신 |
| ② 온보딩 | 완성 | 없음(D1) |
| ③ 데이터 저장 | 완성 | GitHub API 실통신 |
| ④ Import | 완성 | 대상 홈페이지 실제 크롤링 |
| ⑤ 미리보기 | 완성(단, 비실시간) | — |
| ⑥ 도메인 연결 | 완성(API 토큰 없으면 Manual Mode로 자동 강등) | DNS-over-HTTPS + HTTPS + Cloudflare API |
| ⑦ 배포 | 완성(API 토큰 없으면 Manual Mode) | Cloudflare Pages API |
| ⑧ 콘텐츠 생성 | 완성 | Anthropic API 실통신 |
| ⑨ 게시 | 완성 | GitHub API 실통신 |
| ⑩ SEO 운영 | **점검 로직은 완성, 정기 자동 실행(스케줄러)은 미구현** | 대상 사이트 실제 fetch |

각 단계 "내부" 로직은 실제 외부 API(GitHub/Cloudflare/Anthropic/DNS)와 통신하는 완성된 코드입니다. 다만 **단계 사이 전환은 대부분 사람이 Dashboard에서 다음 버튼을 눌러야 진행**되는 구조이며, 자동으로 상태가 바뀌는 지점은 배포 시작/성공에 따른 온보딩 `stage` 컬럼 전이 정도입니다.

---

## 5. 데이터 구조

| 데이터 | 저장 위치 | 사용 기능 |
|---|---|---|
| `sites/<id>/hospital.json` | GitHub 저장소(공개 콘텐츠 단일 원천) | 모든 공개 페이지 렌더링, site-settings/entities API |
| `sites/<id>/articles/<slug>.json` | GitHub 저장소(개별 게시 아티클, Phase 7.5 신규 방식) | `load-hospital.js`가 hospital.json의 `articles[]`와 병합(결정적 순서, slug 중복 시 빌드 실패) |
| entity(진료과 `departments[]`/의료진 `doctors[]`) | `hospital.json` 최상위 필드(현재 두 사이트 모두 비어있음) | `/api/entities`, `entity-schema.js`(JSON-LD), `/departments`·`/doctors` 페이지 |
| 업종 템플릿 | `templates/<id>/template.json` (6종: medical/academy/lawyer/restaurant/shopping + 스캐폴드용 hospital) | `src/lib/templates.js`, 현재 전 템플릿이 동일 medical 렌더링 공유(업종별 UI는 미구현) |
| Cloudflare D1 (10개 마이그레이션, 11개 테이블) | 내부 운영 데이터 전용(공개 콘텐츠 아님) | 아래 표 |
| GitHub 커밋 | `functions/_lib/publisher.js` (Contents API, sha 낙관적 잠금) | site-settings/entities/sites/jobs-article/import-apply 등 모든 콘텐츠 쓰기 경로 |

**D1 테이블**:

| 테이블 | 마이그레이션 | 용도 |
|---|---|---|
| `jobs` | 0001~0004 | AI 콘텐츠 생성 Job(상태/결과/게시상태/배포확인상태) |
| `site_onboarding` | 0005 | 담당자 정보, 운영방식, 전환채널, 도메인, 체크리스트, `stage` |
| `import_jobs` | 0006 | 기존 홈페이지 크롤링 원본/후보 기록 |
| `domain_connections` | 0007 | 도메인 연결 상태, DNS 기대/실제 레코드, `deploy_ready` |
| `deploy_jobs`, `site_deploy_config` | 0008 | 배포 이력(사전검사/결과/검증 JSON), 사이트별 배포 설정 |
| `seo_check_runs`, `seo_findings`, `seo_tasks`, `site_seo_settings` | 0009 | SEO 점검 이력, 발견사항, 작업, 사이트별 점검 설정 |
| `login_rate_limit` | 0010 | 로그인 반복 시도 방어(IP별 고정 윈도우 카운터, §9-2) |

시크릿(GITHUB_TOKEN, ANTHROPIC_API_KEY 등)은 D1에 저장되지 않습니다(코드 확인됨).

---

## 6. 배포 구조

- **SITE 환경변수**(`src/lib/site-id.js`): 어떤 `sites/<id>/hospital.json`으로 빌드할지 결정. 미지정 시 기본값 `aiseolab`. 형식 검증(`^[a-z0-9]+(-[a-z0-9]+)*$`, 50자 이하)으로 path traversal 차단.
- **COMPANY_SITE**: `SITE`와 같으면 "회사 빌드"로 판정 → `index.astro`의 `isCompanySite` 분기가 완전히 다른 홈페이지 마크업을 생성. 병원 빌드는 기존 로직 그대로.
- **`functions/_lib/site-data.generated.js`**: `npm run build`에 포함된 `scripts/generate-writer-site-data.mjs`가 `sites/` 전체를 순회해 매 빌드마다 자동 생성(gitignore 대상). Cloudflare Pages Functions는 JSON을 직접 import하지 않고 이 생성된 JS 모듈만 사용 — 깨진 JSON/slug 중복이 있으면 이 단계에서 빌드 자체가 실패해 조용한 오배포를 막습니다.
- **GitHub 커밋을 통한 배포 트리거**: `main` 브랜치 push → Cloudflare Pages가 자동 빌드/배포하는 전통적 방식. `site-settings`/`entities`/`sites`(생성)/`jobs/:id/publish`/`import/apply` 등 모든 콘텐츠 쓰기가 결국 이 경로를 탑니다.
- **Cloudflare Pages 배포 확인**: `functions/_lib/cloudflare-pages.js`(API Token 없으면 Manual Mode로 자동 폴백)로 배포 생성/상태조회/롤백/Custom Domain 관리. 실제 반영 여부는 `deploy-verify.js`가 대상 URL에 직접 fetch해 `<title>`/canonical/robots/sitemap 등을 검사해 최종 확인.
- **도메인 연결**: `domain-dns.js`(기대 레코드 계산) + `domain-verifier.js`(DNS-over-HTTPS 실조회 + HTTPS 리다이렉트 추적, SSRF 가드 적용) + `domain-status.js`(5단계 진행률·`deploy_ready` 판정)로 구성.

---

## 7. 현재 구현 완료 기능

- 회사 홈페이지 / 병원 홈페이지 분리 렌더링(`isCompanySite`)
- 병원 사이트 생성 마법사(6단계, 검증 포함) + GitHub 자동 커밋
- 온보딩 정보 관리(D1)
- 병원/회사 설정 편집(GitHub 커밋 + SEO 사전검사 + sha 낙관적 잠금 + 회사 사이트 오조작 방지 확인)
- 진료과·의료진(엔티티) CRUD + JSON-LD 자동 생성
- 기존 홈페이지 Import(크롤링 → 신뢰도 점수화 → 사람 검토 → 선택 적용)
- 도메인 연결(DNS-over-HTTPS 검증, Cloudflare Custom Domain 자동 추가)
- 배포 엔진(13항목 사전검사, Preview/Production/Replace, 배포 후 실검증, 롤백)
- AI 콘텐츠 생성(Claude API, 업종별 금지표현 필터링, 프롬프트-데이터 분리)
- 게시(원자적 중복 방지, GitHub 커밋) 및 게시글 수정/삭제/배포확인
- SEO 운영센터(점검 실행 → 규칙엔진 → 점수화 → findings → tasks)
- Dashboard 7탭 UI + 병원별 워크스페이스 전환
- 세션 기반 인증이 전 API에 예외 없이 적용

## 8. 미완성 또는 실제 검증되지 않은 기능

- **정기 자동 SEO 점검 없음**: `triggerType: 'scheduled'`가 스키마·코드에 준비되어 있으나 이를 주기 호출하는 Cloudflare Cron Trigger/GitHub Actions가 저장소에 없습니다(`.github/` 디렉터리 없음, wrangler 설정에 crons 없음 — 확인됨). 사람이 계속 버튼을 눌러야 합니다.
- **사이트 생성 직후 지연**: `ALLOWED_SITES`가 빌드 시 고정 상수라 신규 사이트는 Cloudflare Pages 재빌드(보통 1~2분) 전까지 site-settings/entities/import/deployments 대부분 API가 인식하지 못합니다(`functions/_lib/auth.js`에 TODO로 명시).
- **미리보기 비실시간**: `/sites/<id>/`는 빌드 시점 스냅샷이라 설정을 저장해도 재배포 전까지 반영되지 않습니다.
- **멀티 프로젝트 배포 미구현**: `deploymentStrategy: 'isolated'` 필드는 스키마에 있으나 사이트별 별도 Cloudflare Pages 프로젝트를 자동 생성하는 코드는 없습니다. 현재는 회사 하나의 Pages 프로젝트 + `/sites/<id>/` 경로 공유가 기본(`shared`)이며, `NEXT_TASKS.md`에도 "두 번째 업체 사이트 실증"이 할 일로 남아 있습니다.
- **도메인 연결 해제 API 없음**: `/connect`(추가)만 있고 삭제/해제 API가 없어 Cloudflare Dashboard에서 수동 제거해야 합니다.
- **Playwright로 검증되지 않은 Dashboard 기능**: AI 콘텐츠 생성 탭의 기본 job 생성/조회 흐름(`POST /api/jobs`, `GET /api/jobs`, 생성 실행 버튼)과, 게시된 글 탭의 필터/페이지네이션/수정/삭제/배포확인 액션은 모든 테스트 파일이 빈 배열로 스텁 처리하고 지나가 실제 렌더링·상호작용 테스트가 없습니다.
- **`/privacy` 내용 미작성**: 실제 법적 문구 없이 "준비 중" 상태이며 noindex도 아닙니다.
- **운영 환경 시크릿 설정 여부는 코드로 확인 불가**: `CLOUDFLARE_API_TOKEN`/`ANTHROPIC_API_KEY`/`GITHUB_TOKEN` 등이 실제 Cloudflare Pages 프로덕션에 설정되어 있는지는 이 저장소만으로는 알 수 없습니다. 미설정 시 도메인 자동 연결·배포 자동 트리거·롤백이 전부 "Manual Mode(사람이 직접)"로 강등됩니다.

## 9. 중복 기능이나 구조적으로 위험한 부분

**✅ 해결됨(2026-07-24, 커밋 `2f03eee`) — 저장형 XSS**: 원인은 `functions/_lib/entities.js:46`의 블랙리스트 검증이 아니라 `src/layouts/BaseLayout.astro`가 `<script type="application/ld+json" set:html={JSON.stringify(schema)}>`로 JSON-LD를 이스케이프 없이 출력하던 부분이었습니다. `src/lib/schema.js`에 `safeJsonLdString()`(`<`,`>`,`&`를 `\uXXXX`로 이스케이프)을 추가해 이 출력 지점에 적용했고, 우회 가능하면서 정상적인 의료 문구(괄호·슬래시·`&`·따옴표)를 오탐할 위험이 있던 블랙리스트 정규식은 제거했습니다(구조/타입/길이 검증은 유지). 실제 Chromium 렌더링까지 포함한 회귀 테스트 24개로 검증했습니다. **단, §0-3에서 밝힌 대로 이 수정은 아직 push되지 않아 실제 배포에는 반영되지 않았습니다.**

**✅ 해결됨(2026-07-24, 커밋 `30fe5d0`) — 로그인 브루트포스 방어**: `functions/api/auth/login.js`에 D1 기반 고정 윈도우 레이트리밋(`functions/_lib/login-rate-limit.js`, `migrations/0010_create_login_rate_limit.sql`)을 추가했습니다. `CF-Connecting-IP` 기준 15분당 8회 제한, 원자적 `INSERT...ON CONFLICT DO UPDATE...RETURNING`으로 동시 요청 레이스 컨디션을 방지, 초과 시 비밀번호 비교 자체를 생략하고 429+`Retry-After` 반환, 실패/차단 메시지는 기존과 동일해 계정 존재 여부 비노출 유지, D1 장애 시에는 로그인 자체를 막지 않는 가용성 우선 설계입니다. **역시 아직 push되지 않아 실제 배포에는 반영되지 않았습니다.**

**중간 — 코드 중복(확인됨)**: `siteId` 검증 정규식(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)이 `sites.js`, `seo-operations/[site].js`, `domains/[site].js`, `onboarding/[site].js`, `deployments/[site].js` 5개 파일에 각각 복붙되어 있습니다. 향후 규칙이 바뀌면 5곳을 전부 수정해야 하는 유지보수 리스크입니다. 도메인 형식 검증도 `onboarding.js`(단순 폼 검증)와 `domain-validate.js`(SSRF 방지 포함 엄격 검증) 두 곳에 책임이 분산되어 있습니다.

**낮음(참고) — 배포 검증의 host 유도 경로**: `deployments/[site]/verify.js`는 `job.previewUrl`/`job.targetDomain`에서 host를 유도합니다. 요청 시점에 별도 SSRF 재검사를 하지는 않지만, 두 값 모두 서버가 이전에 생성/검증한 값이라 직접적인 임의 URL 요청 경로로는 보이지 않습니다(도메인 자체가 등록 시점에 `domain-validate.js`로 정규화됨). 확실한 취약점은 아니라 "낮음"으로만 표기합니다.

**해당 없음으로 확인된 항목**: 전 API 인증 누락 없음, SQL Injection 경로 없음(D1 prepared statement만 사용), siteId/slug의 path traversal 방지 확인됨, 시크릿 값이 오류 메시지에 노출되는 코드 경로 없음, 명령/eval 실행 코드 없음.

## 10. 삭제하거나 정리해야 할 테스트 데이터와 죽은 코드

- **`/tmp/test-debug-ai.mjs`, `/tmp/test-diag.mjs`**: `functions/api/debug/ai.js`, `functions/api/debug/env.js`를 import하지만 이 파일들은 이미 삭제되어 존재하지 않습니다. **2026-07-24 재확인: 두 파일 모두 `git ls-files`에 잡히지 않는, 저장소에 커밋된 적 없는 세션 임시 스크립트였습니다.** 저장소 안에는 삭제할 대상이 없어 조치 불필요로 종결했습니다. (참고로 이 세션 동안 이 저장소에는 `test` npm 스크립트도, 커밋된 테스트 스위트도 없다는 점도 함께 확인했습니다 — 검증은 전부 애드혹 스크립트로 이뤄지고 있어, 향후 최소한의 테스트를 저장소에 커밋해 두는 것을 권장합니다. **아래 "요약 표"의 "Playwright 검증됨"·"유닛 테스트 검증됨" 표기들도 전부 이와 같은 방식 — 검증 시점에 임시로 작성해 실행하고 저장소에는 커밋하지 않은 애드혹 스크립트 — 을 가리키는 것이며, 저장소에 실제로 존재하는 재실행 가능한 테스트 스위트를 의미하지 않습니다.**)
- **`sites/andrology/hospital.json`의 플레이스홀더 값**: `name: "○○비뇨의학과"`, `description`/`hero.title`/`hero.subtitle`/`services[0..2]`/`faq[0..3]`가 전부 "예시입니다" 형태의 스캐폴드 문구이며, `phone`/`address`/`hours`/`doctor`는 전부 "미정"입니다. `articles` 배열에는 실제 콘텐츠(`erectile-dysfunction-causes`)와 함께 **순수 예시 아티클 2건(`article-1`, `article-2` — "이 글은 예시 본문입니다")이 실제 게시물과 섞여 있어 정리가 필요합니다.**
- 그 외 `functions/_lib/**`의 죽은(미참조) 헬퍼 모듈, 참조 깨진 죽은 테스트, `sites/` 안의 잔여 테스트 사이트는 전수 조사 결과 발견되지 않았습니다(Playwright 테스트의 `bright-dental`/`doremi-urology` 등은 실제 저장소가 아니라 테스트 파일 안의 mock 데이터일 뿐입니다).
- (참고, 이미 처리됨) `sites/aiseolab/articles/`의 병원 주제(전립선) 오염 아티클은 지난 작업에서 이미 삭제되었고 이번 조사에서도 재확인되지 않았습니다.

## 11. 지금 당장 개발을 재개하기 전에 결정해야 할 사항

0. **(신규, 최우선) GitHub push 인증 수단 확보** — §0-3 참고. 이 문제가 해결되어 push가 완료되기 전까지는 아래 "해결됨" 항목들을 포함한 이번 세션의 모든 작업이 실제 배포에 반영되지 않습니다.
1. **`sites/andrology/hospital.json`을 실제 운영 데이터로 교체할지, 계속 데모/스캐폴드로 둘지** — 이 사이트를 기준으로 두 번째 실제 병원을 검증할 계획이라면 예시 아티클 2건과 플레이스홀더 필드부터 정리해야 합니다. (이번 세션에서 대표님이 "다음 작업"으로 남겨두기로 확인하신 항목 — 아직 미착수)
2. ~~`/doctors`, `/departments` 공개 페이지의 XSS 가능성(§9)을 지금 막을지~~ → **2026-07-24 해결됨**(§9, §0-1 참고)
3. **SEO 정기 점검을 자동화할지(Cloudflare Cron 등 도입) 아니면 당분간 수동 운영으로 갈지** — 병원 수가 늘어나면 수동 운영의 한계가 빠르게 옵니다.
4. **멀티테넌트 배포 전략(`isolated` vs `shared`)을 언제 실제로 구현할지** — 지금 구조로 두 번째 실제 병원을 배포할 수 있는지(도메인 공유 문제 없는지) 먼저 검증이 필요합니다.
5. ~~로그인 브루트포스 방어를 애플리케이션 레벨에서 추가할지~~ → **2026-07-24 해결됨**(§9, §0-1 참고)
6. **`/privacy` 페이지의 법적 문구를 언제 채워 넣을지** — 실제 서비스를 오픈한다면 필수입니다.
7. **Dashboard(4,683줄 단일 파일)를 지금 분리/리팩터링할지, 기능 추가를 계속 쌓을지** — 파일이 커질수록 향후 수정 난이도와 리스크가 커집니다. (7탭 구조 개편은 완료되었으나 파일 분리 자체는 미착수)

## 12. 추천 개발 순서

이 감사는 우선순위를 "정하는" 문서가 아니라 "판단에 필요한 사실을 정리하는" 문서이므로, 아래는 발견된 사실에 기반한 참고용 제안입니다. 최종 순서는 §11의 결정 사항에 달려 있습니다.

1. ~~`test-debug-ai.mjs`/`test-diag.mjs` 삭제~~ → 확인 결과 저장소에 없는 파일(제 세션 임시 스크립트)이라 해당 없음으로 종결
2. ~~보안: `entities.js` 입력 검증 방식 전환, `BaseLayout.astro` JSON-LD 이스케이프~~ → **완료**(§9). ~~로그인 브루트포스 방어~~ → **완료**(§9)
3. **(최우선, 신규) GitHub push 인증 확보 후 push** — 완료된 보안 수정을 실제 배포에 반영하는 것이 다음 조치의 전제 조건입니다.
4. `sites/andrology/hospital.json`의 예시 아티클 2건과 플레이스홀더 필드 정리 — 실제 값 확보 또는 명시적 TODO/비공개 처리 방식 결정 필요(임의 생성 금지 원칙)
5. (운영 준비) `/privacy` 실제 문구 작성
6. (실사용 검증) 두 번째 실제 병원 사이트로 등록→온보딩→배포까지 전체 흐름을 실제로 한 번 완주해 보며 "사이트 생성 직후 지연", "미리보기 비실시간" 등이 실제 운영에 걸림돌인지 확인
7. (확장) 정기 SEO 점검 자동화(Cron), 멀티 프로젝트 배포 전략 구현은 병원 수가 늘어나는 시점에 맞춰 진행
8. (유지보수) `siteId` 검증 정규식 공용 유틸화, Dashboard 파일 분리는 다른 기능 개발과 충돌하지 않는 시점에 별도로 진행

---

## 요약 표

**표기 안내**: 아래 "Playwright 검증됨"·"유닛 테스트 검증됨"은 모두 각 기능을 만들 때(이전 세션 포함, 이번 세션의 보안 수정 포함) **임시로 작성해 그 자리에서 실행한 애드혹 스크립트**(`/tmp/*.mjs` 등)를 통한 검증입니다. §10에서 확인한 대로 이 저장소에는 `test` npm 스크립트도, 커밋된 공식 테스트 스위트도 없습니다 — 즉 아래 표기는 "저장소에 재실행 가능한 테스트가 존재한다"는 뜻이 아니라 "그 시점에 실제로 동작을 확인했다"는 뜻입니다.

| 기능 | 구현 상태 | 실제 검증 여부 | 위험도 | 다음 조치 |
|---|---|---|---|---|
| 회사/병원 홈페이지 분리 렌더링 | 완료 | Playwright 검증됨(25개 체크) | 낮음 | 없음 |
| 병원 사이트 생성 마법사 | 완료 | Playwright 검증됨 | 낮음 | 없음 |
| 온보딩 관리 | 완료 | Playwright 검증됨 | 낮음 | 없음 |
| 설정/엔티티 편집(GitHub 커밋) | 완료 | Playwright + 유닛 테스트 검증됨 | 낮음 | 없음 |
| 진료과·의료진(엔티티) 공개 렌더링 | 완료 | 데이터 유무 + XSS 회귀 테스트(실제 Chromium 렌더링 포함) 검증됨 | **해결됨**(단, 미push — §0-3) | push 후 배포 반영 확인 |
| Import(기존 홈페이지 수집) | 완료 | Playwright 검증됨 | 중간(서버 임의 URL fetch) | SSRF 가드 범위 재확인 권장 |
| 도메인 연결 | 완료 | Playwright 검증됨 | 낮음 | 해제 API 부재만 참고 |
| 배포 엔진(Preview/Production/Replace/Rollback) | 완료 | Playwright 검증됨 | 낮음 | 없음 |
| AI 콘텐츠 생성(Job 생성/실행) | 완료(코드상) | **UI 상호작용 테스트 없음** | 중간(미검증) | Playwright 테스트 추가 |
| 게시(승인) | 완료 | Playwright 검증됨 | 낮음 | 없음 |
| 게시된 글 탭(필터/수정/삭제/배포확인) | 완료(코드상) | **UI 상호작용 테스트 없음** | 중간(미검증) | Playwright 테스트 추가 |
| SEO 운영센터(수동 점검) | 완료 | Playwright 검증됨 | 낮음 | 없음 |
| SEO 정기 자동 점검(스케줄러) | **미구현** | 해당 없음 | 중간(운영 부담) | Cron/Actions 도입 결정 |
| 로그인 브루트포스 방어 | 완료(D1 레이트리밋 + 원자적 카운터) | 회귀 테스트 8건 검증됨(동시요청 레이스 컨디션 포함) | **해결됨**(단, 미push — §0-3) | push 후 배포 반영 확인 |
| `/privacy` 법적 문구 | **미구현(스텁)** | 해당 없음 | 낮음(법적 리스크는 별도 판단 필요) | 문구 작성 |
| 멀티 프로젝트(isolated) 배포 | **미구현** | 해당 없음 | 중간(확장 시 필요) | 두 번째 병원 검증 후 결정 |
| `sites/andrology` 예시 데이터 | 정리 필요 | — | 낮음 | 실데이터 교체 또는 삭제(§11-1, 아직 미착수) |
| `test-debug-ai.mjs`/`test-diag.mjs` | 저장소에 없는 파일로 확인 | — | 없음 | 조치 불필요(종결) |
| **GitHub push (14개 커밋)** | **로컬 완료, push 실패** | 이 세션에서 직접 확인 | **중간(운영 반영 지연)** | push 인증 수단 확보 후 즉시 push |

---

*이 문서는 2026-07-23 100% 읽기 전용 조사로 최초 작성되었습니다. 2026-07-24 갱신분(§0, §9 해결 표시, §11/§12 일부, 요약표 일부)은 실제로 완료된 코드 수정·git 커밋·병합 내역을 반영한 것이며, 상세 근거는 §0에 기록했습니다.*
