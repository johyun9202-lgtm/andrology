# AI 자동 생성 가이드 (write-article) — AI Writer Engine v1

키워드만 입력하면 프롬프트 생성 → Claude API 호출 → 검증 → 등록까지
자동으로 처리하는 명령입니다. (설계: `AI_WRITER_ENGINE.md`)

## 준비물: API 키

Anthropic API 키가 필요합니다 (호출당 실비용 발생).

```
PowerShell:  $env:ANTHROPIC_API_KEY="발급받은 키"; npm run write-article
CMD:         set ANTHROPIC_API_KEY=발급받은 키 && npm run write-article
```

키가 없으면 기존 수동 방식(`npm run draft-article` → `npm run import-ai`)을
그대로 사용하면 됩니다 — 수동 경로는 계속 유지됩니다.

## 사용 방법

```
npm run write-article
1) 사이트 ID (Enter = 기본값)
2) 핵심 키워드
3) slug
4~9) 나머지는 Enter로 기본값 사용 가능
→ Claude 호출 (약 1~3분)
→ [미리보기] 제목·요약·섹션 구성 표시
→ 등록할까요? (Y/n)
```

- **Y(기본)**: 자동 등록 → 검토 후 git commit·push 하면 배포
- **n**: 등록 취소, 초안만 `content-drafts/{slug}.article.json`에 저장
  (검토·수정 후 `npm run import-ai`로 등록 가능)

## 자동으로 처리되는 것

- 프롬프트: draft-article과 **완전히 동일한 프롬프트** 사용 (공용 빌더)
- 검증: Article Model v2 구조 검증 — 실패 시 오류 사유를 Claude에게 전달하며
  **최대 2회 자동 재생성**. 그래도 실패하면 `content-drafts/{slug}.failed.txt`에
  저장하고 종료 (사람이 수정 후 import-ai로 등록 가능)
- 등록: create-article/import-ai와 같은 파이프라인 (중복 차단·SEO 검사·실패 시 복원)
- 기록: 실행 조건이 `content-drafts/{slug}.brief.json`으로 남음

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (없음, 필수) | API 키. 저장소에 절대 커밋하지 말 것 |
| `AI_WRITER_MODEL` | `claude-sonnet-5` | 사용할 모델 |
| `SITE` | `aiseolab` | 기본 사이트 |

## 주의

- 이 명령은 **등록까지만** 자동입니다. 실제 배포(git push)는 사람이 검토 후 진행합니다.
- 게시 전 의료 내용·광고 표현의 담당자 최종 검토는 필수입니다.
- 글 1편당 API 호출 1~3회(재시도 포함)의 비용이 발생합니다.
