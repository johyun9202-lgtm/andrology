# Article Review & Publishing Engine (Phase 7)

AI가 생성한 completed Job을 **사람이 검토·승인**하면, GitHub 저장소의
사이트 원본에 아티클을 커밋하고 Cloudflare Pages 자동 배포로 실제 게시합니다.

> 원칙: 자동 생성 즉시 발행하지 않습니다. 반드시
> **completed → 검토 → 승인 → publishing → published/publish_failed** 흐름을 거칩니다.

## 저장 구조 (Phase 7.5 — 개별 파일)

아티클 원본은 두 곳이며, 빌드 시 로더(src/lib/load-hospital.js)가 하나로 병합합니다.

- **기존**: `sites/<siteId>/hospital.json`의 `articles` 배열 — 계속 지원 (기존 글 유지)
- **신규 게시**: `sites/<siteId>/articles/<slug>.json` — 파일 1개 = Article Model v2 객체 1개

병합 순서는 결정적입니다(배열 순서 → 파일명 오름차순). slug 중복·깨진 JSON·모델 위반은
어느 파일이 문제인지 명시된 오류로 **빌드가 중단**됩니다.
전환 배경(1MB 한도 실측 등)은 **docs/article-storage-architecture.md** 참고.

- frontmatter 없음 — 필드는 Article Model v2 (slug/title/summary/date/intro/sections/faq/relatedArticles)
- slug 규칙: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (article-validator의 isValidSlug), 파일명 = `<slug>.json` 강제
- 직렬화 규칙: `JSON.stringify(article, null, 2) + '\n'`
- URL 규칙: `site.url + /articles/<slug>/` (build format: directory) — **기존과 동일, 변경 없음**

따라서 게시 = **검증된 아티클 파일 1개를 새로 만드는 커밋**입니다.
읽기-수정-쓰기가 없어 충돌·용량 문제가 구조적으로 사라집니다.

## 전체 게시 흐름

```
Dashboard 결과 미리보기(검토) → [게시 승인] → 확인 대화상자
  → POST /api/jobs/:id/publish  (관리자 인증 필수)
     1. Job 존재·completed 확인, 결과를 Article Model v2로 재검증
     2. GitHub 설정 확인 (미설정 시 선점 전에 오류 — publishing 잔류 방지)
     3. 게시 선점: draft/publish_failed → publishing (조건부 UPDATE, 원자적)
     4. 게시용 SEO slug 생성 (draft-xxxxxxxx → 영문 토큰 기반, 불가 시 ai-날짜-ID)
     5. 빌드 시점 사이트 데이터(SITE_DATA)의 기존 slug와 선제 충돌 검사
     6. GitHub Contents API PUT 1회 — sha 없이 "생성 전용"
        · 파일이 이미 있으면 GitHub가 409/422 반환 → 충돌 오류 (덮어쓰기 불가)
     7. 성공: published (파일 path/url/commit SHA/published_at 저장)
        실패: publish_failed (안전한 오류 메시지 저장, 재시도 가능)
  → 커밋되면 Cloudflare Pages가 자동 재배포 (1~2분 소요될 수 있음)
     · 재배포 빌드의 check:seo가 병합 결과 전체를 다시 검증 (최종 방어선)
```

## 상태 모델

AI 생성 상태(status)와 게시 상태(publish_status)는 **별도 컬럼**입니다.

```
status:          queued → running → completed / failed   (기존 그대로)
publish_status:  draft → publishing → published
                          └─────────→ publish_failed → (재시도) publishing → ...
```

- published: 재게시 불가 (서버 차단)
- publish_failed: "게시 다시 시도" 가능
- publishing 상태로 **15분 이상** 방치된 경우(요청 중단 등)에만 재선점 허용
  — 그 외의 자동 복구는 하지 않습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/jobs/:id/publish | 게시 실행. 성공 `{ok:true, job}` / 실패 `{ok:false, error, job}` |

주요 응답: 401(미로그인) · 400(잘못된 ID/사이트) · 404(없는 Job) ·
409(completed 아님 / 이미 게시 중·게시됨) · 422(결과 없음·형식 오류) ·
500(게시 실패 — publish_failed로 저장)

GET /api/jobs, /api/jobs/:id 응답에는 publishStatus / publishedPath / publishedUrl /
publishCommitSha / publishErrorMessage / publishedAt이 포함됩니다.
(GitHub Token 등 민감 정보는 어떤 응답·로그·DB에도 저장되지 않습니다)

## Cloudflare 환경변수 / Secret

| 이름 | 종류 | 설명 |
|---|---|---|
| GITHUB_TOKEN | **Secret (필수)** | GitHub fine-grained token. 응답·로그·D1에 절대 노출 안 됨 |
| GITHUB_OWNER | 변수 (선택) | 기본값 `johyun9202-lgtm` |
| GITHUB_REPO | 변수 (선택) | 기본값 `andrology` |
| GITHUB_BRANCH | 변수 (선택) | 기본값 `main` |
| GITHUB_ARTICLE_BASE_PATH | 변수 (선택) | 기본값 `sites` (hospital.json 상위 경로) |

## GitHub Fine-grained Token 최소 권한

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate:

1. Repository access: **Only select repositories** → `johyun9202-lgtm/andrology` 하나만
2. Permissions → Repository permissions:
   - **Contents: Read and write** (필수 — 이것 하나만)
   - Metadata: Read (자동으로 함께 부여됨)
3. 만료 기한을 설정하고, 만료 시 Secret 교체

다른 권한(Actions, Issues, Admin 등)은 **주지 마세요**. 토큰이 유출되더라도
이 저장소의 파일 읽기/쓰기 외에는 아무것도 할 수 없는 상태가 최소 권한입니다.

## Migration (배포 전 필수)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0003_add_job_publish_fields.sql --remote
```

publish_status / published_path / published_url / publish_commit_sha /
publish_error_message / published_at / publish_started_at 컬럼을 추가합니다.
**미실행 시 Job 목록 조회부터 실패합니다.** (로컬은 `--local`로 0001→0002→0003 순서)

## 파일 경로·URL 규칙

- 커밋 대상 파일: `sites/<siteId>/articles/<slug>.json`
  (예: `sites/aiseolab/articles/ai-20260721-1a2b3c4d.json`)
- 커밋 메시지: `Publish article: <site>/<slug> (<jobId>)` — 개인정보 없음
- 게시 URL: `<site.url>/articles/<slug>/` (예: `https://aiseolab.kr/articles/ai-20260721-1a2b3c4d/`)
- slug: 제목·키워드의 영문/숫자 토큰으로 생성(8자 이상일 때), 한글 키워드 등으로
  불가하면 `ai-<YYYYMMDD>-<JobID 8자리>` 형식. 충돌 시 자동 넘버링 없이 오류로 알림.

## 실패 복구

| 상황 | 처리 |
|---|---|
| GITHUB_TOKEN 미설정/형식 오류 | 선점 전 오류 반환 (publishing 상태 안 만듦) |
| GitHub 401 | "인증 실패 — 토큰 확인" 안내, publish_failed |
| GitHub 403 (권한/한도) | 권한 안내 또는 호출 한도 안내, publish_failed |
| GitHub 404 | 저장소/브랜치/경로 설정 확인 안내, publish_failed |
| 409/422 (파일 이미 존재) | "이미 같은 slug의 파일 존재" 충돌 오류 — 덮어쓰기 불가, publish_failed |
| 동일 slug (빌드 시점 데이터 기준) | GitHub 호출 전 선제 차단, publish_failed |
| 타임아웃/네트워크 | 재시도 안내, publish_failed |
| 아티클 형식 오류 | 커밋 전 차단 (validator), 원인 요약 저장 |
| publishing 잔류 | 15분 경과 후 "게시 다시 시도"로 재선점 가능 |

참고: 사이트 전체 SEO 검사는 게시 시점이 아니라 **재배포 빌드의 check:seo**가
수행합니다 (병합된 전체 articles 대상). 게시 시점에는 아티클 단위 검증(validator)과
slug 충돌 검사가 적용됩니다.

모든 사용자 메시지는 간결한 한국어이며, 토큰·GitHub 응답 원문은 노출하지 않습니다.
운영 로그에는 `[게시 실패] job=... site=... message=...`만 남습니다.

## Cloudflare 자동 배포와의 관계

GitHub 커밋 성공 = **published**입니다. 실제 사이트 반영은 Cloudflare Pages의
자동 빌드·배포가 끝나야 하므로(보통 1~2분), UI에 "배포 진행 중일 수 있음"을
안내하고 published_url 링크를 제공합니다. 배포 완료 여부 확인(deployed 상태 분리)은
향후 Phase입니다.

## 현재 한계 / 향후 계획

- (Phase 8에서 연결됨) 실제 배포 확인·게시 글 수정·삭제는
  **docs/published-article-management.md** 참고 (migration 0004 필요).

- 본문 편집기 없음 — 편집 추가 지점: Dashboard 미리보기(articlePreview)와
  게시 승인 버튼 사이. 편집 결과를 PATCH로 result에 저장한 뒤 게시하는 구조 권장.
- slug 수정 UI 없음 — 서버가 안정적으로 생성. 향후 승인 단계에서 편집 허용 예정.
- 예약 발행, 다중 AI 검토, Search Console 색인 요청, 배포 완료 확인은 향후 Phase.
- 게시는 aiseolab·andrology 등 ALLOWED_SITES에 등록된 사이트만 가능.
- **주의: andrology 등 의료 사이트의 콘텐츠는 게시 전 전문가(병원 담당자) 검토가
  필수입니다. 승인 버튼은 "사람이 검토했다"는 선언입니다.**
