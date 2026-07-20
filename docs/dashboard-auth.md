# Dashboard 인증 + Job API 가이드 (Phase 4)

## 인증 구조

단일 관리자 비밀번호(MVP) 방식입니다.

```
/login 에서 비밀번호 입력
→ POST /api/auth/login (서버가 ADMIN_PASSWORD와 상수 시간 비교)
→ 성공 시 HMAC-SHA256 서명 세션 쿠키 발급
   (HttpOnly · Secure · SameSite=Strict · Path=/ · 8시간 만료)
→ /dashboard 진입 시 세션 확인, API 호출 시 서버가 세션 재검증
```

- 쿠키에는 만료시각과 서명만 담깁니다 — 비밀번호·Secret은 절대 포함되지 않습니다.
- 비밀번호는 코드·저장소 어디에도 없으며 Cloudflare Secret으로만 주입됩니다.

## API 목록 (Cloudflare Pages Functions — `functions/` 폴더)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/auth/login | 로그인 `{password}` → 세션 쿠키 발급, 실패 401 |
| POST | /api/auth/logout | 세션 쿠키 만료 |
| GET | /api/auth/session | 로그인 여부 `{authenticated}` |
| POST | /api/jobs | (인증 필수) `{keyword, title?, site}` → Job 객체 반환 |

허용 외 메서드는 405. 인증 없는 /api/jobs는 401. 잘못된 site·빈/과도한 keyword는 400.

## Cloudflare에서 설정해야 할 Secret (Pages 프로젝트 → Settings → Variables and Secrets)

| 이름 | 설명 |
|---|---|
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 |
| `SESSION_SECRET` | 세션 서명용 키 — **32자 이상의 임의 문자열** (예측 불가능하게) |

aiseolab 프로젝트에만 설정하면 됩니다. (andrology는 대시보드 미사용)

## 로컬 실행 방법 (Windows)

`npm run dev`(Astro 개발 서버)는 **Functions를 실행하지 않습니다.**
API까지 로컬에서 확인하려면 Wrangler로 실행합니다 (별도 설치 없이 npx 사용):

```
1) .dev.vars.example 을 복사해 .dev.vars 생성 후 실제 값 입력
   copy .dev.vars.example .dev.vars
2) 빌드 후 Wrangler로 실행
   npm run build
   npx wrangler pages dev dist
3) 표시된 주소(보통 http://localhost:8788)에서 /login 접속
```

`.dev.vars`는 .gitignore에 등록되어 있어 커밋되지 않습니다.
간단한 UI 확인만 필요하면 `npm run dev`로도 화면은 볼 수 있습니다(API는 미동작).

## 현재 한계 (v1)

- **Job은 영구 저장되지 않습니다.** 접수 응답만 반환하며, 새로고침하면 목록이 사라집니다.
- /dashboard·/login HTML 자체는 정적 파일이라 서버 리다이렉트로 숨길 수 없습니다.
  화면 접근은 세션 확인 후 클라이언트 이동으로 처리하고, **실제 기능(API)은 전부
  서버 인증으로 차단**됩니다. HTML에는 민감한 데이터가 없습니다.
- 허용 사이트 목록은 `functions/_lib/auth.js`의 ALLOWED_SITES 상수입니다.
  새 사이트 추가 시 함께 갱신하세요.

## 다음 단계 연결 위치

- **D1 (Job 영구 저장)**: `functions/api/jobs.js`의 Job 생성 직후 — INSERT 후 반환.
  목록 조회용 `GET /api/jobs` 추가 예정.
- **Claude API 호출**: 같은 파일에서 Job 접수 후 비동기 처리(Queues 또는 Workers cron)로 연결.

## Claude API 연결 전 점검사항

1. Cloudflare Secret 2종 설정 완료 및 로그인 동작 확인 (실배포 환경)
2. ANTHROPIC_API_KEY를 Pages Secret으로 추가할 준비 (저장소 금지 원칙 동일)
3. Job 저장소(D1) 먼저 연결 — 호출 결과를 저장할 곳이 있어야 함
4. 비용 통제: Job당 호출 상한·일일 상한 정책 결정
5. 생성 결과의 사람 검토 관문 유지 (등록≠발행 원칙)
