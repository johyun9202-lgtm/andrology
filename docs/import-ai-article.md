# AI 아티클 가져오기 가이드 (import-ai)

Claude/ChatGPT가 출력한 아티클 JSON을 **터미널에 붙여넣기만 하면**
파일 저장(content-drafts)과 사이트 등록까지 한 번에 처리하는 명령입니다.
메모장에 저장하고 경로를 입력하는 중간 단계가 사라집니다.

## 전체 워크플로우

```
npm run draft-article        ← 프롬프트 생성
→ 생성된 prompt.md를 Claude에 입력
→ Claude가 출력한 JSON 복사
npm run import-ai            ← 이 명령
→ 사이트 선택 → JSON 붙여넣기 → END 입력
→ 자동 저장 + 자동 등록 완료
→ git commit·push → Cloudflare 자동 배포
```

## 사용 방법

1. `npm run import-ai` 실행
2. 사이트 ID 입력 (Enter만 누르면 기본값)
3. Claude가 출력한 JSON 전체를 붙여넣기 (여러 줄 그대로)
4. **새 줄에 `END` 입력 후 Enter** → 입력 종료
   (CMD에서는 Ctrl+Z 후 Enter, PowerShell/Git Bash에서는 Ctrl+D도 가능)

## 자동으로 처리되는 것

- ```` ```json ```` 코드펜스가 붙어 있어도 자동 제거
- JSON 앞뒤 공백·빈 줄 정리
- Article Model v2 구조 검증 (create-article과 동일 규칙)
- 중복 slug 차단
- `content-drafts/{slug}.article.json` 자동 저장 (보기 좋은 들여쓰기)
- 전체 SEO 검사 → 오류 시 hospital.json과 초안 파일 모두 원래 상태로 복원

## 주의

- JSON 앞뒤에 설명문이 섞여 있으면 등록하지 않고 명확한 오류를 표시합니다.
  이 경우 `{` 부터 `}` 까지만 복사해 다시 실행해 주세요.
- 같은 이름의 초안 파일이 이미 있으면 덮어쓸지 물어보며, **기본값은 No**입니다.
- 등록 실패 시 사이트 데이터와 초안 파일은 어떤 부분도 변경되지 않습니다.
- 게시 전 의료 내용과 광고 표현은 반드시 담당자가 최종 검토해 주세요.

## 파일로 등록하고 싶을 때

JSON을 파일로 이미 저장해 둔 경우에는 기존 방식(`npm run create-article`)을
그대로 사용하면 됩니다. 두 명령은 같은 등록 파이프라인을 공유합니다.
→ `docs/create-article.md` 참고
