# AI 아티클 프롬프트 생성 가이드 (draft-article)

## 기능 목적

Claude·ChatGPT·Gemini에 붙여넣을 수 있는 **고품질 아티클 생성 프롬프트 파일**을
자동으로 만들어 주는 명령입니다. 사이트 정보(병원명, 진료과목, 기존 글, FAQ)와
Article Model v2 출력 규칙이 프롬프트에 자동 포함되므로, AI가 등록 가능한 형식의
JSON을 곧바로 출력합니다.

**왜 API 직접 연결 전에 이 단계를 쓰나요?** — API를 연결하기 전에 "AI에게 무엇을
어떻게 시킬지"(프롬프트 품질)가 먼저 검증되어야 합니다. 이 단계에서 프롬프트를
다듬어 두면, 향후 API 자동 연결 시 같은 프롬프트를 그대로 재사용할 수 있습니다.
**실제 AI API 자동 호출은 향후 버전**이며, 이 명령은 외부 API를 전혀 호출하지 않습니다.

## 실행 방법

```
npm run draft-article
```

## 입력 항목

| 항목 | 필수 | 기본값(Enter) |
|---|---|---|
| 사이트 ID | 필수 | andrology |
| 핵심 키워드 | 필수 | — |
| slug (글 주소) | 필수 | — (영문 소문자·숫자·하이픈) |
| 보조 키워드 | 선택 | 없음 |
| 검색 의도 | 선택 | 정보 탐색 |
| 대상 독자 | 선택 | 해당 증상이나 질환 정보를 찾는 일반 사용자 |
| 글의 목적 | 선택 | 정확하고 이해하기 쉬운 의료 정보 제공 |
| 목표 분량 | 선택 | 1800~2500자 |
| 추가 지시사항 | 선택 | 없음 |

## 생성 파일

```
content-drafts/{slug}.prompt.md
예: content-drafts/prostate-enlargement-causes.prompt.md
```

같은 이름의 프롬프트 파일·아티클 초안·등록된 아티클 slug가 이미 있으면
**덮어쓰지 않고** 중단됩니다. 사이트 원본(hospital.json)은 절대 수정되지 않습니다.

## 사용 방법 (생성 후)

1. 파일 열기: `notepad content-drafts\{slug}.prompt.md`
2. 내용 전체를 복사해 Claude 또는 ChatGPT에 붙여넣기
3. AI가 출력한 JSON을 복사한 뒤 **`npm run import-ai`** 실행 → 터미널에 붙여넣기 → `END` 입력
   — 저장과 등록이 자동으로 처리됩니다. (→ `docs/import-ai-article.md`)

또는 기존 방식: JSON을 `content-drafts\{slug}.article.json` 파일로 직접 저장한 뒤
`npm run create-article`로 등록해도 됩니다.

전체 흐름: `draft-article` → Claude에 프롬프트 입력 → JSON 복사 → `import-ai` → 자동 저장·등록
등록 단계에서 구조 검증·중복 차단·SEO 검사·실패 시 복원이 자동으로 처리됩니다.

## 의료 콘텐츠 주의

프롬프트에 과장·단정 금지 원칙이 포함되어 있지만, AI 초안의 의료적 정확성과
의료광고법 적합성은 자동 보증되지 않습니다. **게시 전 반드시 의료전문가 또는
병원 담당자가 내용을 검토**해 주세요.
