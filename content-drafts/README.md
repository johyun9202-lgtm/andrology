# content-drafts — 아티클 JSON 초안 보관 폴더

등록 전 아티클 JSON 초안을 보관하는 폴더입니다.
이 폴더의 파일은 사이트에 자동으로 노출되지 않으며,
`npm run create-article`로 등록해야 실제 사이트 데이터에 반영됩니다.

## 사용 방법

1. `templates/hospital/article.json`을 이 폴더로 복사해 파일명을 바꾼다.
   (예: `new-article.json`)
2. slug, title, summary, content(문단 배열)를 작성한다.
   - Claude/GPT에게 "templates/hospital/article.json 형식에 맞춰 출력해 달라"고 요청하면
     그대로 이 폴더에 저장해 사용할 수 있습니다.
3. `npm run create-article` 실행 후 파일 경로를 입력한다.
4. 등록 완료 후 초안 파일은 삭제하거나 별도 보관해도 됩니다.

자세한 규칙: `docs/create-article.md`
