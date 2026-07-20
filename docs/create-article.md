# 아티클 등록 가이드 (create-article)

작성된 글(JSON)을 사이트의 articles에 안전하게 등록하는 명령입니다.
AI(Claude/GPT 등)로 글을 작성한 뒤 이 명령으로 등록하는 것이 기본 흐름이며,
향후 AI 자동 생성 파이프라인이 이 명령을 그대로 사용합니다.

> 팁 1: `npm run draft-article`로 AI에 붙여넣을 프롬프트를 자동 생성할 수 있습니다.
> → `docs/create-draft-prompt.md` 참고.
>
> 팁 2: AI가 출력한 JSON을 파일로 저장하지 않고 터미널에 바로 붙여넣어 등록하려면
> `npm run import-ai`를 사용하세요. → `docs/import-ai-article.md` 참고.
>
> 전체 흐름: `draft-article` → Claude에 프롬프트 입력 → JSON 복사 → `import-ai` → 자동 저장·등록

## 실행

```
npm run create-article
```

입력 항목: ① 사이트 ID (Enter만 누르면 기본값) ② 아티클 JSON 파일 경로

## 아티클 JSON 작성 방법

기준 형식(스키마): `templates/hospital/article.json` — 이 파일을 `content-drafts/`로
복사해 내용을 채우면 됩니다. 두 가지 형식을 모두 지원하며 **서로 완전히 호환**됩니다.

### 방법 1 — 간단한 형식 (기존 방식, 계속 사용 가능)

```json
{
  "slug": "male-health-guide",
  "title": "남성 건강검진 전에 알아두면 좋은 준비 사항",
  "summary": "검색 결과에 표시될 50~160자 요약 설명",
  "date": "2026-07-19",
  "content": [
    "첫 번째 문단",
    "두 번째 문단"
  ]
}
```

### 방법 2 — Article Model v2 (소제목·목록·FAQ·관련 글 지원)

```json
{
  "slug": "example-article",
  "title": "예시 제목",
  "summary": "검색 결과와 글 목록에 표시할 요약",
  "date": "2026-07-20",
  "updatedAt": "2026-07-20",
  "intro": "글의 도입문",
  "sections": [
    {
      "heading": "첫 번째 H2 제목",
      "paragraphs": ["첫 번째 문단", "두 번째 문단"],
      "subsections": [
        {
          "heading": "H3 제목",
          "paragraphs": ["세부 설명"],
          "items": ["목록 항목 1", "목록 항목 2"]
        }
      ]
    }
  ],
  "faq": [
    { "question": "질문", "answer": "답변" }
  ],
  "relatedArticles": ["another-article-slug"]
}
```

### 필드 정리

| 필드 | 구분 | 설명 |
|---|---|---|
| slug, title, summary | **필수** | 주소·제목·요약(meta description) |
| 본문 | **필수** | `content`(문단 배열) 또는 `sections` 중 하나에는 실제 내용 필요 |
| date | 선택 | 없으면 오늘 날짜 자동 입력 (YYYY-MM-DD) |
| updatedAt | 선택 | 수정일 (YYYY-MM-DD, date보다 이전이면 오류) |
| intro | 선택 | 본문 맨 앞 도입문 |
| sections | 선택 | heading은 H2, subsections.heading은 H3, paragraphs는 문단, items는 목록(ul/li)으로 렌더링 |
| faq | 선택 | 페이지 하단에 표시 + FAQ 구조화 데이터(JSON-LD) 자동 생성. 없으면 생성 안 함 |
| relatedArticles | 선택 | 관련 글 slug 목록 — 실제 존재하는 글만 표시되며, 없는 slug가 있어도 페이지는 깨지지 않음(경고만) |

- 아티클 **객체 1개**만 허용 — 배열이나 `{"articles": [...]}` 형식은 거부됩니다.
- 모든 텍스트는 HTML 태그 없이 일반 텍스트로 작성합니다.
  (`<script`, `javascript:` 등 위험 패턴은 새 필드를 포함한 전체에서 등록이 차단됩니다)

## slug 규칙

영문 소문자·숫자·하이픈만. 하이픈으로 시작·끝나거나 연속 하이픈, 공백, 슬래시,
대문자, 한글은 사용할 수 없습니다. slug가 곧 페이지 주소가 됩니다:
`https://도메인/articles/슬러그/`

## 안전 장치

- **중복 슬러그 차단**: 같은 slug가 이미 있으면 등록 거부, 기존 아티클 불변
- **안전 저장**: 임시 파일에 먼저 쓰고 검증 후 교체
- **전체 SEO 검사 자동 실행**: 오류가 1개라도 있으면 hospital.json을 원래 상태로
  자동 복원하고 등록을 취소합니다. 경고만 있으면 등록됩니다.

## Windows 파일 경로 입력 예시

```
content-drafts\new-article.json
F:\AI-SEO\drafts\new-article.json
"F:\AI SEO\drafts\new article.json"   ← 공백 있는 경로는 따옴표 포함 그대로 붙여넣어도 됩니다
```

## 실제 사용 예시

```
npm run create-article
1) 사이트 ID (Enter = 기본 사이트):
2) 아티클 JSON 파일 경로: content-drafts\new-article.json
...
아티클 등록 완료
URL: https://andrology.co.kr/articles/male-health-guide/
```

등록 후 git commit·push하면 Cloudflare가 자동 배포합니다.

## 향후 AI 연결 방향

AI가 `templates/hospital/article.json` 스키마에 맞는 JSON을 생성해 저장하면,
이 CLI가 구조 검증 → 중복 차단 → SEO 검사 → 안전 저장을 자동 처리합니다.
성공 시 종료 코드 0, 실패 시 1이므로 자동화 스크립트에서 그대로 사용할 수 있습니다.

## 의료 콘텐츠 주의

이 명령의 검증은 데이터 구조와 기술적 SEO 검증이며, 의료적 정확성이나
의료광고법 적합성을 보증하지 않습니다. **게시 전 반드시 의료전문가 또는 병원
담당자가 내용을 검토**하고, 치료 효과를 보장하는 표현이나 허위·과장 광고 여부를
별도로 확인해 주세요.
