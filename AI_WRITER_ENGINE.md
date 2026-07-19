# AI Writer Engine — 설계 문서 (v1 설계안, 구현 전)

> 상태: **설계만 완료, 코드 미구현**
> 위치: Prompt Generator(`draft-article`)와 Importer(`import-ai`) **사이**에 들어가는 자동화 엔진

---

## 1. 목표

현재 콘텐츠 루프에서 사람이 하는 "복사–붙여넣기" 구간을 자동화한다.

```
[현재]  draft-article → (사람: 프롬프트 복사 → Claude에 입력 → 결과 복사) → import-ai
[목표]  write-article → 키워드만 입력하면 프롬프트 생성 → AI 호출 → 검증 → 등록까지 자동
```

기존 엔진들은 그대로 두고, 그 사이를 잇는 **연결 엔진**만 추가한다.
프롬프트 규칙·검증 규칙·등록 규칙은 이미 검증된 기존 모듈을 재사용하며 새로 만들지 않는다.

## 2. 전체 흐름 (5단계)

```
1) 키워드 입력      npm run write-article → 사이트 ID·키워드·slug 입력 (기존 CLI UX 재사용)
2) 정보 구조 생성    "작성 브리프(Writing Brief)" JSON 생성 — 사이트 정보 + 키워드 + 작성 조건
3) 프롬프트 생성     기존 draft-article의 프롬프트 빌더를 함수로 재사용해 동일 품질의 프롬프트 생성
4) AI 호출·검증     Claude API 호출 → JSON 정리 → article-validator 검증 → 실패 시 자동 재시도
5) Importer 전달    기존 registerArticle()로 등록 (중복 차단·SEO 검사·실패 시 복원 그대로 적용)
```

## 3. 구성 요소 설계

### 신규 파일 (구현 시)

| 파일 | 역할 |
|---|---|
| `scripts/write-article.mjs` | CLI 진입점. `npm run write-article`. 입력 → 브리프 → 호출 → 등록 오케스트레이션 |
| `scripts/lib/ai-client.mjs` | AI API 호출 계층. Node 내장 `fetch` 사용(외부 SDK 불필요). 모델·재시도·타임아웃 관리 |
| `scripts/lib/prompt-builder.mjs` | 기존 `create-draft-prompt.mjs`의 프롬프트 생성부를 함수로 **분리 이동** (내용 변경 없음) |

### 재사용 (수정 최소화)

| 기존 모듈 | 재사용 내용 |
|---|---|
| `create-draft-prompt.mjs` | 프롬프트 본문 규칙 → prompt-builder로 분리 후 양쪽에서 공유 |
| `import-ai-article.mjs`의 `cleanJsonText()` | 코드펜스·공백 정리 |
| `article-validator.mjs` | Article Model v2 구조 검증 |
| `article-importer.mjs` `registerArticle()` | 등록·중복 차단·SEO 검사·롤백 |
| `site-id.js` / `site-data` 구조 | 사이트 선택·검증 |

핵심 원칙: **AI Writer Engine에는 새로운 "규칙"이 없다.** 규칙은 전부 기존 모듈에 있고,
이 엔진은 순서대로 호출하는 조립 계층이다. 규칙이 바뀌면 한 곳만 고치면 된다.

## 4. 작성 브리프(Writing Brief) 데이터 구조

2단계에서 만들어지는 내부 구조. 향후 일괄 생성(v2)·관리자 화면에서도 같은 구조를 사용한다.

```json
{
  "siteId": "andrology",
  "slug": "prostate-enlargement-causes",
  "mainKeyword": "전립선 비대증 원인",
  "subKeywords": ["배뇨장애", "전립선염"],
  "searchIntent": "정보 탐색",
  "audience": "해당 증상 정보를 찾는 일반 사용자",
  "purpose": "정확하고 이해하기 쉬운 의료 정보 제공",
  "targetLength": "1800~2500자",
  "extraNotes": ""
}
```

- 필수: siteId, slug, mainKeyword — 나머지는 기본값 (draft-article과 동일)
- 브리프는 `content-drafts/{slug}.brief.json`으로 저장해 실행 기록을 남긴다 (재실행·감사 용도)

## 5. AI 호출 계층 설계 (ai-client)

- **API**: Anthropic Messages API (Claude). Node 18+ 내장 fetch 사용 — 외부 SDK 설치 없음
- **API 키**: 환경변수 `ANTHROPIC_API_KEY` 로만 주입. 코드·저장소에 키를 절대 저장하지 않음
  - `.env` 파일 사용 시 `.gitignore`에 반드시 포함 (이미 `.env` 패턴 등록되어 있음 — 확인됨)
  - 키가 없으면: 오류가 아니라 **수동 모드 안내** — "프롬프트 파일을 생성했으니 기존 방식(draft-article → import-ai)으로 진행하세요"
- **모델**: 설정값으로 관리 (기본: 품질 우선 모델 1개 고정, 향후 비용/품질 옵션화)
- **타임아웃·재시도**: 네트워크 오류 시 1회 재시도, 응답 없음 대비 타임아웃 설정
- **비용 통제**: 호출 1회당 예상 비용을 실행 전 안내, 일괄 모드(v2)에서는 편수 상한 필수

## 6. 결과 검증·재시도 정책 (4단계 상세)

```
AI 응답
 → cleanJsonText()로 정리 (코드펜스 등)
 → JSON.parse
 → validateArticle() (구조·타입·slug·위험 패턴)
 ├─ 통과 → 5단계(등록)로
 └─ 실패 → 실패 사유를 AI에게 그대로 전달하며 재생성 요청 (최대 2회)
      └─ 2회 후에도 실패 → 마지막 응답을 content-drafts/{slug}.failed.txt로 저장하고
         명확한 오류와 함께 종료 (사람이 검토·수정 후 import-ai로 수동 등록 가능)
```

- 재시도 시 프롬프트에 추가되는 내용: "이전 출력의 오류: {validator 오류 목록}. 수정해 JSON만 다시 출력."
- 등록 단계(registerArticle)의 SEO 오류로 실패한 경우도 동일하게 1회 재생성 기회를 준다
- 어떤 실패 경로에서도 hospital.json은 변경되지 않음 (기존 롤백 보장 그대로)

## 7. 안전장치

| 항목 | 정책 |
|---|---|
| 자동 발행 금지 | 엔진은 **등록까지만** 한다. git commit·push(=실제 배포)는 사람이 한다 — 의료 콘텐츠 최종 검토 관문 유지 |
| 등록 전 미리보기 | 기본 동작: 검증 통과 후 제목·요약·섹션 구성을 보여주고 "등록할까요? (Y/n)" 확인. `--yes` 성격의 자동 모드는 v2에서 검토 |
| 중복 방지 | slug 중복은 기존 로직이 차단. 브리프 저장으로 같은 키워드 중복 발행 여부도 확인 가능 |
| 의료 콘텐츠 | 프롬프트의 기존 금지 규칙(과장·단정·수치 창작 금지) 그대로 + 완료 메시지에 검토 안내 유지 |
| 키 보안 | 환경변수만 사용, 로그에 키 미출력, 저장소에 키 관련 파일 커밋 금지 |

## 8. CLI 사용 흐름 (구현 시 목표 UX)

```
npm run write-article

1) 사이트 ID (Enter = andrology):
2) 핵심 키워드: 전립선 비대증 원인
3) slug: prostate-enlargement-causes
4~9) 보조 키워드/의도/독자/목적/분량/추가 지시 (Enter = 기본값)

프롬프트 생성 완료 → Claude 호출 중... (약 1~2분)
응답 수신 → 구조 검증 통과 (경고 1)

[미리보기] 제목 / 요약 / 섹션 4개 / FAQ 3개
등록할까요? (Y/n): y

아티클 등록 완료
URL: https://.../articles/prostate-enlargement-causes/
다음: 내용 검토 후 git commit·push 하면 배포됩니다.
```

## 9. 단계별 구현 계획

| 버전 | 범위 | 비고 |
|---|---|---|
| **v1** | 단일 글 대화형 생성 (위 흐름 전체) + prompt-builder 분리 | 최소 기능. 여기까지가 다음 구현 대상 |
| v2 | 키워드 목록 일괄 생성 (`keyword-plan` 기반 N편 연속, 편수 상한·비용 안내) | NEXT_TASKS 1-1 키워드 전략과 연결 |
| v3 | 스케줄 실행·발행 큐 (주 N편 자동 초안) | 사람 검토 관문은 계속 유지 |

## 10. 이번 설계에서 제외한 것 (하지 않을 것)

- 웹 검색·사실 자동 검증 (AI 지식 기반 초안 + 사람 검토 원칙 유지)
- 이미지 생성, CMS, 관리자 화면, 데이터베이스
- git 자동 commit·push, 자동 배포
- OpenAI/Gemini 동시 지원 (v1은 Claude 단일 — 추상화는 ai-client 한 파일로 족함)
- 기존 draft-article·import-ai 제거 (수동 경로는 API 장애·키 없음 상황의 대비책으로 유지)

## 11. 리스크와 대응

- **API 비용**: 글 1편당 호출 1~3회(재시도 포함). v2 일괄 모드에 편수 상한과 사전 비용 안내 필수
- **품질 편차**: 프롬프트는 이미 실전 검증됨. 재시도 정책 + 미리보기 확인으로 편차 흡수
- **의료 책임**: 자동화되어도 "등록≠발행" 구조로 사람 검토 관문이 항상 남음 — 이 원칙은 버전이 올라가도 유지
- **키 유출**: 환경변수 전용 + gitignore. 키가 커밋되면 즉시 폐기·재발급이 원칙

---

**요약**: AI Writer Engine은 새 규칙 없이 기존 5개 모듈을 잇는 조립 엔진이다.
구현 시 신규 파일 3개(write-article, ai-client, prompt-builder 분리)로 완성되며,
콘텐츠 1편 발행에 필요한 사람의 작업이 "키워드 입력 + 최종 검토" 두 가지로 줄어든다.
