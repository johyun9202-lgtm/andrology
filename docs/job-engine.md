# Job Engine + D1 영구 저장 가이드 (Phase 5)

Dashboard에서 생성한 AI 작업(Job)을 Cloudflare D1에 영구 저장합니다.
새로고침해도 목록이 유지되며, 이후 Claude API 연결 단계의 저장 기반이 됩니다.

## 구조

```
Dashboard → POST /api/jobs → D1 INSERT → Job 반환
Dashboard 진입 → GET /api/jobs → 최근 30개 (created_at DESC)
상태 변경 → PATCH /api/jobs/:id (status/progress/result/error)
```

- SQL은 `functions/_lib/job-repository.js`(JobRepository) 한 곳에만 존재하며,
  전부 prepared statement + 바인딩 파라미터라 SQL Injection이 불가능합니다.
- 모든 Job API는 로그인 세션 필수입니다.

## Cloudflare 설정 (대표님이 1회 진행)

### 1) D1 데이터베이스 생성

```
npx wrangler d1 create aiseolab-jobs
```

(또는 Cloudflare 대시보드 → Storage & Databases → D1 → Create)

### 2) Migration 실행

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0001_create_jobs.sql --remote
```

`--remote`가 실제 Cloudflare DB에 적용하는 옵션입니다.

### 3) Pages 프로젝트에 바인딩 연결

aiseolab Pages 프로젝트 → Settings → Bindings → **D1 database** 추가

| 항목 | 값 |
|---|---|
| Variable name (바인딩 이름) | `DB` (반드시 이 이름) |
| D1 database | aiseolab-jobs |

바인딩 저장 후 재배포되면 적용됩니다.

## API 목록

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/jobs | Job 생성 → D1 저장 (queued, progress 0) |
| GET | /api/jobs | 최근 Job 최대 30개 (created_at DESC) |
| GET | /api/jobs/:id | 단일 Job 조회 (없으면 404) |
| PATCH | /api/jobs/:id | status(queued/running/completed/failed)·progress(0~100)·result·error 변경 |

## 상태 표시 (Dashboard)

대기 중(회색) · 진행 중(파랑) · 완료(초록) · 실패(빨강)

## 로컬 실행 (Windows)

```
npm run build
npx wrangler d1 execute aiseolab-jobs --file=migrations/0001_create_jobs.sql --local
npx wrangler pages dev dist --d1 DB=aiseolab-jobs
```

- `--local`은 내 컴퓨터의 임시 DB에 적용합니다 (실서버와 별개)
- `.dev.vars`에 ADMIN_PASSWORD / SESSION_SECRET 필요 (docs/dashboard-auth.md 참고)

## 현재 한계 / 다음 단계

- Job은 저장·조회·상태 변경까지만 지원합니다. **실제 글 생성(Claude API),
  Article 등록, GitHub Push는 아직 연결되지 않았습니다.**
- 다음 단계(Claude API 연결) 위치: `functions/api/jobs.js`의 INSERT 직후 —
  Job을 running으로 바꾸고 생성 → 완료 시 result 저장 → completed/failed 갱신.
- PATCH는 현재 수동/향후 워커용 API이며 Dashboard UI에는 노출되지 않습니다.
