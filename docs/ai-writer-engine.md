# AI Writer 실행 엔진 (Phase 6)

Dashboard에서 생성한 queued Job을 **실제 Claude API로 실행**해
아티클 초안(JSON)을 생성하고 결과를 D1에 영구 저장합니다.

> 이 단계에는 SERP 분석·경쟁사 크롤링·GitHub 자동 배포가 포함되지 않습니다.
> "가장 작은 안정적인 실행 구조"까지만 구현되어 있습니다.

## 실행 흐름

```
Dashboard [글 생성 실행] 클릭
  → POST /api/jobs/:id/run  (로그인 세션 필수)
     1. Job 조회 (없으면 404)
     2. 실행 선점: queued/failed → running (조건부 UPDATE, 원자적)
     3. 프롬프트 생성  (scripts/lib/prompt-builder.mjs 재사용 — CLI와 동일 규칙)
     4. Claude API 호출 (fetch, 90초 타임아웃)
     5. 응답 파싱·검증  (scripts/lib/article-validator.mjs 재사용)
     6-a. 성공 → result 저장, status=completed, progress=100, completed_at 기록
     6-b. 실패 → error 저장,  status=failed, completed_at 기록 (다시 실행 가능)
```

## 상태 전환

```
queued ──실행──▶ running ──성공──▶ completed   (재실행 불가)
failed ──재실행─▶ running ──실패──▶ failed      (다시 실행 가능)
```

- running / completed 상태의 재실행은 **서버에서** 차단됩니다(409).
  프론트 버튼 비활성화는 UX용 보조 장치일 뿐입니다.
- 실행 선점은 `WHERE status IN ('queued','failed')` 조건부 UPDATE 한 번으로
  처리되어, 동시에 두 요청이 와도 하나만 성공합니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/jobs/:id/run | Job 실행. 성공 `{ok:true, job}`, 실패 `{ok:false, error, job}` |

주요 응답 코드: 401(미로그인) · 400(잘못된 ID) · 404(없는 Job) ·
409(이미 실행 중/완료) · 500(생성 실패 — Job은 failed로 저장됨)

## 결과 저장 형식 (jobs.result — JSON 문자열)

```json
{
  "title": "...",
  "slug": "draft-xxxxxxxx",
  "metaDescription": "...",
  "excerpt": "...",
  "keyword": "...",
  "generatedAt": "2026-07-20T12:34:56.000Z",
  "model": "claude-sonnet-5",
  "article": { "...Article Model v2 전체 (sections, faq 등)..." }
}
```

- `article`은 기존 Article Model v2 그대로이므로, 이후 등록 단계에서
  기존 import 파이프라인을 그대로 사용할 수 있습니다.
- `metaDescription`은 Article Model v2의 `summary`, `excerpt`는 `intro`에 대응합니다.
- slug는 서버가 Job ID로부터 결정한 임시값(`draft-xxxxxxxx`)입니다.
  발행 시 사람이 검토하며 SEO에 맞는 slug로 변경하는 것을 전제로 합니다.
- AI 응답이 코드펜스로 감싸졌거나 JSON이 아닐 경우 안전하게 파싱 실패 처리되어
  failed 상태 + 한국어 오류 메시지로 저장됩니다.

## 환경 변수 (Cloudflare Pages → Settings → Variables and Secrets)

| 이름 | 종류 | 설명 |
|---|---|---|
| ANTHROPIC_API_KEY | **Secret (필수)** | Claude API 키. 코드·로그·응답에 절대 노출되지 않음 |
| AI_WRITER_MODEL | 변수 (선택) | 모델명 재정의. 미설정 시 `claude-sonnet-5` |
| ANTHROPIC_API_URL | 변수 (선택) | API 호출 주소 재정의. 아래 "403 Request not allowed" 참고 |
| ADMIN_PASSWORD / SESSION_SECRET | Secret (기존) | docs/dashboard-auth.md 참고 |

모델명 기본값은 `functions/_lib/ai-writer.js`의 `DEFAULT_MODEL` 상수 한 곳에서만 관리합니다.

## 403 "Request not allowed"가 발생하는 경우

이 오류는 API 키·요청 형식 문제가 아니라, Anthropic 보안 계층이
**호출 위치(Cloudflare 데이터센터의 서버 IP)** 를 차단할 때 발생하는 알려진 현상입니다.
해결 방법은 Cloudflare가 공식 제공하는 **AI Gateway**로 우회하는 것이며,
코드 수정 없이 환경변수 하나로 전환됩니다.

1. Cloudflare 대시보드 → **AI** → **AI Gateway** → Create Gateway (이름 예: `aiseolab`)
2. Pages 프로젝트 → Settings → Variables and Secrets에 변수 추가:

   ```
   ANTHROPIC_API_URL = https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/anthropic/v1/messages
   ```

   (`<ACCOUNT_ID>`, `<GATEWAY_ID>`는 AI Gateway 화면의 API 주소에서 그대로 복사)
3. 재배포 후 "다시 실행" — 헤더(x-api-key, anthropic-version)는 동일하게 동작합니다.

**중요 — 이것만으로 충분합니다 (공식 문서의 "Unauthenticated Gateway" 방식):**

- **Authenticated Gateway는 켜지 않아도 됩니다.** 선택 사항인 보안 기능이며,
  꺼져 있으면 요청은 x-api-key만으로 정상 통과합니다.
- **Provider Keys(BYOK)는 등록하지 않아도 됩니다.** BYOK는 키를 게이트웨이에
  "저장"해 두고 요청에서 키를 생략하는 선택 기능입니다. UI의
  "Your gateway needs to be authenticated to store and use keys" 문구는
  키를 저장하려는 경우에만 해당하는 전제 조건입니다. 우리는 매 요청에
  x-api-key를 직접 보내므로 해당 없음.
- (선택) 보안을 위해 Authenticated Gateway를 켜는 경우: AI Gateway에서 토큰을
  발급받아 Pages Secret `CF_AIG_TOKEN`에 넣으면 코드가 자동으로
  `cf-aig-authorization: Bearer <토큰>` 헤더를 추가합니다. 켜지 않으면 불필요.

부가 효과: AI Gateway 대시보드에서 호출 수·비용·오류를 모니터링할 수 있습니다.

## 필요한 Migration

```
npx wrangler d1 execute aiseolab-jobs --file=migrations/0002_add_job_run_timestamps.sql --remote
```

`started_at`, `completed_at` 컬럼을 추가합니다. **배포 전 반드시 실행해야 합니다.**
(미실행 시 Job 목록 조회부터 실패합니다 — SELECT에 새 컬럼이 포함됨)

로컬 테스트 시에는 `--local`로 0001, 0002를 순서대로 실행하세요.

## 오류 처리 원칙

- 모든 실패는 사용자에게 안전한 한국어 메시지로 변환됩니다 (스택·내부 정보 미노출)
- 외부 API 오류 문구는 제어문자 제거 + 200자 제한 후에만 전달
- error 컬럼 저장 값은 500자 제한
- 키워드·제목은 프롬프트 삽입 전 sanitize(제어문자·코드펜스 제거) — 프롬프트 인젝션 기본 방어
- AI가 만든 slug는 무시하고 서버가 정한 slug로 강제

## 현재 한계 / Cloudflare Queues 전환 지점

- **단일 요청 동기 처리**입니다. 실행 버튼을 누른 브라우저가 응답을 기다리며,
  생성에 1~2분 걸릴 수 있습니다. 브라우저를 닫으면 결과 확인은 안 되지만
  Job 상태는 서버에서 갱신됩니다(단, 요청이 중간에 끊기면 running으로 남을 수 있음).
- 타임아웃 90초 초과 시 failed 처리 후 "다시 실행"으로 재시도합니다.
- 향후 전환 방안: `POST /api/jobs/:id/run`이 **Cloudflare Queues에 메시지만 넣고
  즉시 202를 반환** → Queue consumer(Worker)가 Claude 호출·저장을 수행 →
  Dashboard는 GET /api/jobs 폴링으로 상태 확인. 현재 구조에서 run.js의
  "호출·저장" 부분(ai-writer.js)이 그대로 consumer로 이동하면 되도록 분리되어 있습니다.
- running 상태로 방치된 Job의 자동 복구(스테일 타임아웃)는 Queue 전환 시 함께 도입 예정.
- 생성된 글은 **초안**입니다. 특히 의료 콘텐츠는 발행 전 반드시 사람이 검토해야 합니다.
- (Phase 7에서 연결됨) 검토 후 실제 게시는 `POST /api/jobs/:id/publish` —
  **docs/article-publishing-engine.md** 참고.
