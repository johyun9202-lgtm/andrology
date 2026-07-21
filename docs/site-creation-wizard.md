# Site Creation Wizard (Phase 11)

Dashboard에서 4단계 마법사로 새 사이트를 만들면, GitHub 저장소에
`sites/<siteId>/` 폴더(설정 파일 + 아티클 폴더)가 커밋됩니다.

> 범위: 이번 단계는 **Repository 내부 sites/ 폴더 생성까지**입니다.
> Cloudflare Pages 프로젝트 생성·Repository 생성·도메인 연결은 향후 Phase입니다.

## 생성 흐름

```
Dashboard → 사이트 설정 탭 → [＋ 새 사이트 만들기]
  Step 1  사이트 이름 (예: 밝은 치과)
  Step 2  업종 선택 (Template Registry — medical/restaurant/lawyer/academy/shopping)
  Step 3  siteId (영문 slug, ^[a-z0-9-]+$, 2~30자)
  Step 4  요약 확인 → [사이트 생성]
→ POST /api/sites → GitHub 커밋 2건:
   sites/<siteId>/hospital.json   (선택한 템플릿 기반)
   sites/<siteId>/articles/.gitkeep
→ Cloudflare 자동 재배포(1~2분) 후 목록·사이트 설정·글 생성에서 선택 가능
```

## 생성되는 hospital.json

- create-site 스캐폴드(templates/hospital/hospital.json)를 기반으로 이름을 반영
- **medical**: 기존 스캐폴드 그대로 (template 필드 생략 = 기본값 — 기존 구조 유지)
- **비의료 업종**: `template` 필드 기록 + `schema.type: LocalBusiness` +
  병원 전용 예시 문구를 중립 문구로 교체 (업종별 전용 문구·UI는 향후 Phase)
- site.url은 placeholder(`https://example.com`) — 실제 도메인 연결 시 수정 필요

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/sites | 사이트 목록(id/name/template/siteUrl) + 템플릿 목록 |
| POST | /api/sites | `{name, template, siteId}` → 생성 → `{siteId, commitSha, note}` |

모두 관리자 인증 필수. GITHUB_TOKEN은 기존 Publisher 헬퍼를 재사용하며
클라이언트·응답·로그에 노출되지 않습니다.

## 검증·보안

- siteId: `^[a-z0-9]+(-[a-z0-9]+)*$` 2~30자 — 경로 조작 불가
- 중복 금지 2중 확인: ① 빌드 번들(ALLOWED_SITES) ② 저장소 실시간 GET
  (200이면 409) + ③ 생성 전용 PUT(sha 없음)이라 동시 생성도 409/422로 차단
- template: 빌드 번들의 Template Registry(TEMPLATES)에 존재해야 함
- 이름: 1~60자, `<`·`>`·제어문자 차단

## ALLOWED_SITES 변경 (Phase 11)

기존 하드코딩 목록(`['aiseolab','andrology']`)을 **sites/ 폴더 기준 파생**
(`Object.keys(SITE_DATA)`)으로 교체했습니다. 새 사이트는 커밋 → 재배포 후
자동으로 허용 목록에 포함되어 글 생성·게시·설정 대상이 됩니다.
기존 aiseolab·andrology는 그대로 유지됩니다.

## 알려진 한계

- 새 사이트는 **재배포가 끝나야** 대시보드 선택 목록·API 허용 목록에 나타납니다
  (목록은 빌드 시 번들 기준 — UI에 안내 문구 표시)
- 새 사이트의 실제 웹사이트 노출은 별도의 Cloudflare Pages 프로젝트
  (SITE=<siteId> 환경변수) 생성이 필요합니다 — 향후 자동화 예정
- 사이트 삭제 기능 없음 (저장소에서 직접 폴더 삭제)

## 테스트

`/api/sites` 24개 테스트: 인증, 목록, siteId 검증(경로 조작·대문자·길이),
중복(번들·저장소·동시 생성), 템플릿 검증, medical/비의료 생성 파일 내용,
생성 전용 PUT, 커밋 메시지, GitHub 오류, 토큰 미노출 — 전부 GitHub 스텁으로
수행하며 실제 저장소는 수정하지 않습니다.
