# 아티클 저장 구조 (Phase 7.5)

## 구조 요약

```
sites/<siteId>/
  hospital.json          ← 사이트 설정 + (기존) articles 배열 — 계속 지원
  articles/
    .gitkeep
    <slug>.json          ← 신규 게시 글: 파일 1개 = Article Model v2 객체 1개
```

빌드·검사·Functions 데이터 생성은 모두 `src/lib/load-hospital.js` 한 곳의
병합 로직을 사용합니다: hospital.json의 articles 배열(원래 순서) 뒤에
`articles/*.json`을 **파일명 오름차순**으로 붙입니다. `[slug].astro`,
SEO 검사, sitemap, schema는 병합된 배열을 그대로 사용하므로 **수정이 없습니다.**

## 왜 개별 파일인가 (실측 근거)

단일 hospital.json 방식은 게시 시 GitHub Contents API로 파일 전체를
GET(base64)→수정→PUT 해야 하는데, **GET(base64)은 1MB까지만 content를
반환**합니다(GitHub 공식 문서). 실측 아티클 평균 ~4.3KB 기준 **사이트당
약 230개에서 게시가 완전히 중단**되는 구조였습니다. 그 전에도 매 게시마다
전체 파일 재전송(1,000개 시 base64 5.6MB), git 이력에 전체 파일 blob 누적,
단일 sha 경쟁으로 동시 게시 시 무조건 충돌하는 문제가 있었습니다.

개별 파일 방식은 게시가 **"새 파일 PUT 1회"**로 끝납니다. 읽기 없음,
sha 경쟁 없음, 커밋 diff는 새 파일 하나(≈4KB), 파일이 이미 있으면 GitHub가
409/422를 반환해 덮어쓰기가 원천 불가능합니다.

빌드는 병목이 아닙니다(이 저장소 실측: 아티클 100개 2.9초 / 1,000개 4.2초 /
10,000개 35초, 모두 성공). 실질 상한은 Cloudflare Pages의 배포당 20,000파일
한도로, 사이트당 약 9,000글 수준입니다. 그 이상은 향후 별도 설계(D1 하이브리드 등).

## 검증 규칙 (로더에서 즉시 오류 → 빌드 중단)

- 깨진 JSON → 어느 파일인지 명시한 오류
- Article Model v2 위반 → 파일명 + 첫 번째 검증 오류
- 파일명 ≠ `<slug>.json` → 오류
- slug 중복(배열 내 / 파일 간 / 배열↔파일) → **어느 출처와 어느 출처가
  충돌하는지** 명시한 오류
- `articles/` 폴더가 없거나 비어 있어도 정상 (`.gitkeep`·비JSON 파일 무시)

## 기존 hospital.json과의 호환

- 기존 배열 글(andrology 3개, aiseolab 1개)은 **그대로 유지**되며 이동 의무가 없습니다.
- 새 게시 엔진은 개별 파일만 생성합니다. 두 방식은 병합 로더로 공존합니다.
- URL·SEO·sitemap·schema 출력은 저장 위치와 무관하게 동일합니다.

## 기존 글 마이그레이션 방법 (선택, 향후)

1. hospital.json의 articles 배열에서 글 객체 1개를 잘라내
   `sites/<siteId>/articles/<slug>.json`으로 저장 (`JSON.stringify(article, null, 2) + '\n'`)
2. 배열에서 해당 항목 제거
3. `npm run check:seo` → 빌드 확인 (중복이면 로더가 즉시 오류)
글 수가 적으므로 수동으로 충분하며, 필요 시 일괄 변환 스크립트를 추가할 수 있습니다.

## CLI(import-ai / create-article) 전환 지점 (향후)

현재 CLI는 hospital.json 배열에 추가하는 기존 방식을 유지합니다(병합 로더 덕분에
게시 엔진과 충돌하지 않음 — slug 중복은 로더가 차단). 개별 파일 방식으로 전환하려면
`scripts/lib/article-importer.mjs`의 registerArticle에서 "배열 push + 전체 재저장"을
"`articles/<slug>.json` 파일 생성"으로 바꾸면 되고, 검증·SEO 검사 로직은 그대로
재사용됩니다.

## 게시 글 수정·삭제 (Phase 8)

게시된 개별 파일은 Dashboard의 "게시된 글" 탭에서 수정(sha 기반 PUT)·삭제(sha 기반
DELETE)할 수 있습니다. 상세: docs/published-article-management.md

## Functions(게시 엔진)와의 관계

- Workers는 파일시스템을 읽을 수 없으므로, 빌드 시
  `scripts/generate-writer-site-data.mjs`가 **병합된** 사이트 데이터를
  `functions/_lib/site-data.generated.js`로 생성해 번들에 포함합니다.
- publisher의 선제 slug 충돌 검사는 이 번들(=마지막 배포 시점) 기준입니다.
  배포 이후 게시된 글은 다음 재배포 때 번들에 반영되지만, 그 사이에도
  **sha 없는 PUT의 409/422**가 실제 파일 존재를 최종 판정하므로 안전합니다.
