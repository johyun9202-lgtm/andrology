# 배포 확인 & 게시 글 관리 (Phase 8)

GitHub 커밋 성공(=published)과 **실제 사이트 반영 여부**를 분리해 확인하고,
게시된 글을 Dashboard에서 조회·수정·삭제하는 최소 관리 기능입니다.

## 상태 모델

AI 생성(status)·게시(publish_status)·배포(deployment_status) 세 축으로 관리합니다.

```
status:            queued → running → completed / failed          (Phase 5~6)
publish_status:    draft → publishing → published / publish_failed (Phase 7)
                   published → deleted                             (Phase 8 삭제)
deployment_status: pending(기본) → deployed / deploy_failed        (Phase 8)
```

- GitHub 파일 커밋 성공 = `published` (기존 의미 유지 — 하위 호환)
- 실제 URL이 HTTP 200으로 확인됨 = `deployment_status: deployed`
- 404(아직 배포 중) = `pending` 유지 — 1~2분 후 재확인
- 5xx·타임아웃·리다이렉트 이탈 = `deploy_failed` (수동 재확인 가능)
- 수정·재게시 시 deployment_status는 `pending`으로 초기화
- 삭제된 글은 404 확인이 곧 "삭제 반영 완료(deployed)"

기존에 게시된 글은 migration 후 `pending`으로 시작하며,
"배포 확인" 버튼 한 번으로 `deployed`가 됩니다. (데이터 깨짐 없음)

## Migration (배포 전 필수)

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0004_add_deployment_fields.sql --remote
```

추가 컬럼: deployment_status / deployment_checked_at / deployment_error_message /
deployment_attempts / deleted_at / updated_commit_sha / article_updated_at
**미실행 시 Job 목록 조회부터 실패합니다.** (로컬은 `--local`로 0001→0004 순서)

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/jobs/:id/check-deployment | 실제 URL 확인 → deployed/pending/deploy_failed 기록 |
| GET | /api/published-articles | 게시 글 목록 (최신순, 20개 페이지, site/status/deployment/q 필터) |
| GET | /api/jobs/:id/article | 게시 글 데이터 조회 (편집 폼용) |
| PUT | /api/jobs/:id/article | 게시 글 수정 → GitHub 파일 sha 기반 업데이트 커밋 |
| DELETE | /api/jobs/:id/article | 게시 글 삭제 → GitHub 파일 삭제 커밋 + D1 deleted 기록 |

모든 API는 관리자 인증 필수이며 Token·내부 오류 원문은 응답에 포함되지 않습니다.

## 배포 확인 흐름 (SSRF 방지 설계)

검사 URL은 사용자 입력이나 D1의 published_url을 그대로 쓰지 않고,
**빌드에 포함된 사이트 설정(site.url) + 검증된 slug**로만 서버가 조립합니다.
→ localhost·사설 IP·임의 도메인 요청이 구조적으로 불가능합니다.
redirect 발생 시 최종 URL의 origin도 허용 origin과 일치해야 하며,
성공 판정은 HTTP 200 + content-type text/html + 페이지에 slug 포함(가벼운 확인)입니다.
응답 본문은 저장하지 않고 상태·검사 시각·시도 횟수만 D1에 기록합니다.
장시간 백그라운드 자동 재시도는 없으며 Dashboard의 "배포 확인" 버튼으로 수동 확인합니다.

## 수정 흐름

1. Dashboard → 게시된 글 → [수정] → 제목/요약/도입부는 일반 필드, 본문 sections·FAQ는
   JSON 편집(서버에서 Article Model v2 재검증)
2. [미리보기]로 확인 → [저장 후 다시 게시] → **"수정 내용을 검토했으며 다시 게시합니다"** 확인
3. 서버: slug는 D1 값으로 강제(변경 불가) → 현재 파일 GET(sha) → **동일 내용이면 커밋 생략**
   → sha 기반 PUT (`Update article:` 커밋) → updated_commit_sha·article_updated_at 저장,
   D1 result도 수정본으로 갱신, deployment_status=pending
4. 그 사이 파일이 변경돼 있으면 409 충돌 (덮어쓰기 없음)
- slug·게시 URL은 이번 Phase에서 변경 불가 (고위험 — 향후 별도 기능)

## 삭제 흐름

1. [삭제] → 2단계 확인 대화상자
2. 서버: 현재 파일 GET(sha) → sha 기반 DELETE (`Delete article:` 커밋)
3. D1: publish_status=deleted + deleted_at 기록 — **Job 행은 감사 이력으로 유지**
4. 재배포 후 URL이 404가 되며, "배포 확인"으로 삭제 반영을 확인(404=완료)
- GitHub 커밋 이력이 남으므로 실수 삭제도 저장소에서 복구 가능
- 레거시(hospital.json 배열) 글은 이 기능의 대상이 아니며 서버가 차단합니다
  (필요 시 저장소에서 직접 수정)

## 보안

- 전 API 관리자 세션 검증(기존 HMAC 쿠키 재사용), Job ID·site allowlist·경로 형식 검증
- 경로는 D1의 검증된 published_path만 사용, 사용자 입력이 GitHub 경로에 못 들어감
- 수정 데이터는 validator가 재검증(HTML/script 패턴 차단), Dashboard 출력은 textContent 기반
- GitHub Token은 응답·로그·D1 어디에도 저장·노출되지 않음
- GitHub 권한은 기존과 동일: 해당 저장소 **Contents: Read and write** 하나만 (docs/article-publishing-engine.md)

## 알려진 한계

- 배포 확인은 수동(버튼)이며 자동 폴링·백그라운드 작업 없음 (Queue 도입 시 자동화 예정)
- 편집은 sections/FAQ가 JSON 편집 방식 (WYSIWYG는 향후)
- slug·URL 변경, 레거시 글 관리, 예약 발행은 미지원
- **Search Console·Indexing API 제외 이유**: Google Indexing API는 구인공고(JobPosting)·
  라이브방송(BroadcastEvent) 전용으로, 일반 아티클에 사용하는 것은 정책 위반이며
  색인 페널티 위험이 있습니다. 일반 글 색인은 sitemap 기반 자연 크롤링과
  Search Console(향후 Phase에서 sitemap 제출·색인 상태 확인 연동)로 처리하는 것이 정도입니다.
