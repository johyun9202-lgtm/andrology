# Hospital Site Builder MVP (Phase 9A)

관리자 대시보드에서 병원 기본 정보를 입력·저장하면, 그 데이터로
병원형 SEO 홈페이지가 자동 렌더링되는 Site Builder의 최소 구현입니다.

## 기능 개요

```
Dashboard [사이트 설정] 탭
  → 병원 정보 입력 (폼 — raw JSON 편집 없음)
  → PUT /api/site-settings
     · 서버 검증 → 기존 hospital.json에 merge → SEO 검사 → GitHub 커밋
  → Cloudflare Pages 자동 재배포 (1~2분)
  → 홈페이지에 반영 (hero / 진료 분야 / 의료진 / 운영시간·위치 / 최근 칼럼 / 상담 CTA)
```

- AI 글 생성·게시 엔진과 **같은 hospital.json**을 사용하므로,
  설정한 병원 정보가 AI 프롬프트(사이트 정보 블록)에도 그대로 반영됩니다.
- 새 사이트 확장: `sites/<siteId>/hospital.json` 추가 + ALLOWED_SITES 등록(기존 구조 그대로).

## 데이터 구조 (기존 스키마 유지 + optional 확장)

기존 hospital.json 필드는 전부 유지되며, 아래 optional 필드가 추가되었습니다.

| 필드 | 설명 |
|---|---|
| hospitalType | 병원 유형 (예: 비뇨의학과) — SEO 타이틀 fallback에 사용 |
| region | 지역 — SEO 타이틀 fallback에 사용 |
| doctor | 기존 문자열도 계속 지원, 신규는 `{name, title, bio}` 객체 |
| channels.consult / channels.naverMap | 상담 신청·네이버 지도 URL (값이 있을 때만 노출) |
| seo | `{title, description, keywords[]}` — 비어 있으면 안전한 fallback |
| images.hero / images.doctor | 대표·원장 이미지 URL (없으면 이미지 없는 레이아웃) |

렌더링 규칙: **모든 신규 섹션은 데이터가 있을 때만 나타납니다.**
값이 "미정"·빈 문자열이면 해당 섹션이 숨겨져, 데이터가 부족해도 깨지지 않습니다.

## 설정 저장 흐름 (merge 전략)

PUT은 전체 파일을 덮어쓰지 않습니다. 편집 가능한 필드만 갱신하고
articles / nav / home / footer / cta / faq / schema / site.url / theme / hero.buttons 등
폼에 없는 필드는 전부 보존합니다. 진료 분야의 slug는 제목이 같은 기존 항목에서
승계하고, 새 항목은 순번 기반으로 생성합니다.

GitHub 커밋: `Update site settings: <site>` — sha 기반이라 그 사이 파일이
변경되었으면 409(새로고침 후 재시도)로 안전하게 실패합니다.
커밋 전 runSeoCheck를 통과하지 못하면 저장되지 않습니다(빌드 보호).

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/site-settings?site=aiseolab | 현재 설정 + sha + siteUrl |
| PUT | /api/site-settings | `{site, sha, settings}` → 검증·merge·커밋 → `{commitSha, ...}` |

요청 예시(PUT, 일부):

```json
{
  "site": "aiseolab",
  "sha": "<GET에서 받은 파일 sha>",
  "settings": {
    "name": "광주 밝은 비뇨의학과",
    "hospitalType": "비뇨의학과",
    "region": "광주광역시",
    "heroTitle": "충분한 상담을 바탕으로 한 맞춤 진료",
    "services": [{ "title": "전립선 클리닉", "summary": "전립선 관련 상담과 검사" }]
  }
}
```

응답: `{ ok, commitSha, settings, siteUrl, note }`

## 검증·보안

- 관리자 인증 필수 (기존 HMAC 세션 재사용), 사이트는 ALLOWED_SITES만 허용
- URL 필드는 http/https만 (javascript: 등 차단), 전화번호 위험 문자 거부,
  `<` `>` 문자 차단, 길이 제한, 제어문자 제거, 진료 분야 1~10개
- GITHUB_TOKEN은 기존 publisher 헬퍼 재사용 — 응답·로그에 절대 노출 안 됨
- 대시보드는 textContent/DOM 생성 방식만 사용 (innerHTML 미사용)
- 의료광고 주의: 기본 문구·fallback에 "최고/1위/완치/100%/부작용 없음" 등
  과장 표현을 사용하지 않으며, 입력 문구의 최종 책임은 운영자에게 있습니다.

## 홈페이지 렌더링 구조

`src/pages/index.astro`가 병합 로더(siteData)를 읽어 순서대로 렌더링합니다:
Hero(문구·버튼·대표 이미지) → 병원 소개 → (핵심 목표) → 진료 분야 카드 →
의료진 소개(doctor 객체일 때) → 최근 칼럼(병합된 articles 최신 3개, 없으면 숨김) →
진료 시간·위치(실데이터 있을 때) → FAQ → 상담 CTA(존재하는 채널만).
SEO는 기존 Schema Engine을 재사용하며, MedicalClinic 타입은 openingHours·
telephone·address에 더해 진료 분야(medicalSpecialty)가 JSON-LD에 포함됩니다.

## 환경변수

신규 없음 — 기존 GITHUB_TOKEN(필수), GITHUB_OWNER/REPO/BRANCH(선택)를 그대로 사용합니다.
D1 migration도 필요 없습니다.

## 테스트 방법

- 로컬: `npm run build` 후 `npx wrangler pages dev dist` (docs/job-engine.md 참고)
- 대시보드 → 사이트 설정 탭 → 값 수정 → 저장 → GitHub에서
  `Update site settings: <site>` 커밋 확인 → 1~2분 후 홈페이지 열기로 반영 확인

## 알려진 제한 / 향후 확장

- **이미지는 URL 입력 방식**입니다 (파일 업로드는 향후 — R2 연동 검토)
- 저장 후 실제 반영까지 Cloudflare 재배포 시간(보통 1~2분)이 걸립니다
- 사이트 선택은 대시보드에서 가능하지만, 각 도메인의 실제 빌드는
  Pages 프로젝트별 SITE 환경변수를 따릅니다 (기존 멀티사이트 구조 그대로)
- 다중 고객 SaaS 확장 방향: 고객별 sites/<siteId> 생성(create-site 재사용) →
  Pages 프로젝트 자동 생성/도메인 연결 자동화 → 고객 계정·권한 분리 →
  이미지 업로드(R2) → 결제. 현재 구조는 siteId 기반이라 그대로 확장 가능합니다.
