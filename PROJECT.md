# AI SEO 플랫폼 — 프로젝트 현황

> Astro 기반 다중 병원(업체) 사이트 및 SEO 콘텐츠 자동화 플랫폼
> 저장소: `F:\AI-SEO\andrology` · 배포: GitHub → Cloudflare Pages 자동 배포
> 첫 운영 사이트: [andrology.co.kr](https://andrology.co.kr)

---

## 1. 프로젝트 목표

병원 홈페이지 1개를 만드는 것이 아니라, **AI가 어떤 병원(업체)이든 자동으로
SEO 홈페이지와 콘텐츠를 생성·관리할 수 있는 플랫폼**을 만든다.

- 데이터(JSON) 하나만 바꾸면 다른 병원 사이트가 자동 생성되는 구조
- 코드는 하나(공통 템플릿), 업체는 폴더 하나(`sites/업체ID/hospital.json`)
- 콘텐츠는 AI가 생성하고, 시스템이 검증·등록·배포를 자동 처리
- 1인 개발·운영 기준의 단순한 구조 유지 (외부 라이브러리·DB 최소화)

## 2. 현재 완료된 기능 (Git 이력 기준, 15개 커밋)

### 사이트 엔진

| 기능 | 내용 | 커밋 |
|---|---|---|
| Astro 정적 사이트 기반 | 6개 기본 페이지(홈·진료안내·FAQ·아티클·상담문의·개인정보) + 공통 레이아웃/컴포넌트 | `37806ab` |
| 아티클 상세 페이지 | `/articles/{slug}` 독립 페이지 자동 생성 (동적 라우팅) | `ff5a72a` |
| SEO 자동화 | title·meta description·canonical·Open Graph·JSON-LD(MedicalClinic, FAQPage)·sitemap·robots.txt 전부 데이터 기반 자동 생성 | `03af963` |
| 브랜딩 커스터마이즈 | 대표 색상(theme.primary)·로고(images.logo) — JSON 값만으로 변경, 잘못된 값은 안전 차단 | `3d4f3f9` |
| 상담 채널 버튼 | 전화·카카오톡·네이버 예약 — 값이 있는 채널만 자동 표시, URL 보안 검증 | `60f4d8c` |

### 멀티 사이트 엔진

| 기능 | 내용 | 커밋 |
|---|---|---|
| 데이터 접근 단일화 | 모든 페이지가 `src/lib/site-data.js` 로더 한 곳으로만 데이터 접근 | `d7c9f14` |
| 도메인 단일 원천화 | 도메인은 `hospital.json`의 `site.url` 한 곳 — canonical/OG/sitemap/robots 자동 파생, 잘못된 값이면 빌드 실패 | `c389017` |
| SEO 사전 검사 | `npm run check:seo` — 빌드 전 필수 항목 자동 검사, 오류 시 배포 차단 (Cloudflare 빌드에도 적용) | `ffb05d6` |
| 멀티 사이트 | `SITE` 환경변수로 사이트 선택 (`sites/업체ID/hospital.json`), 미지정 시 andrology | `6a4cec1` |
| 사이트 템플릿 + 생성 CLI | `npm run create-site` — 질문 5개로 새 병원 사이트 데이터 생성, SEO 검사 자동 실행 | `3bd14a7` |

### 콘텐츠 파이프라인

| 기능 | 내용 | 커밋 |
|---|---|---|
| 아티클 등록 파이프라인 | `npm run create-article` — JSON 검증·중복 slug 차단·안전 저장·SEO 검사·실패 시 자동 복원 | `0b53fce` |
| Article Model v2 | 소제목(H2/H3)·목록·도입문·아티클별 FAQ(+FAQPage JSON-LD)·관련 글 지원, 기존 형식과 완전 호환 | `338e38e` |
| AI 프롬프트 생성기 | `npm run draft-article` — 사이트 정보가 담긴 Claude/ChatGPT용 프롬프트 파일 자동 생성 | `ac9d0bf` |
| AI 아티클 임포터 | `npm run import-ai` — AI가 출력한 JSON을 터미널에 붙여넣으면 저장·등록까지 자동 처리 | `339887e` |

### 명령어 요약

```
npm run dev            개발 서버
npm run build          SEO 검사 + 빌드 (배포 기준)
npm run check:seo      SEO 사전 검사만 실행
npm run create-site    새 업체 사이트 생성
npm run draft-article  AI용 아티클 프롬프트 생성
npm run import-ai      AI 결과 JSON 붙여넣기 → 자동 등록
npm run create-article JSON 파일로 아티클 등록
```

### 콘텐츠 운영 루프 (검증 완료)

```
draft-article → Claude에 프롬프트 입력 → JSON 복사 → import-ai
→ 자동 검증·등록 → git commit·push → Cloudflare 자동 배포
```

실제 아티클 1건을 이 루프로 발행·배포까지 검증 완료. (테스트 후 정리)

## 3. 현재 진행 중인 작업

- 콘텐츠 운영 단계 진입: draft-article → import-ai 루프로 andrology 실전 아티클 발행 시작
- hospital.json의 "미정" 값(전화·주소·운영시간) 실제 정보 확정 대기
- 로고·대표 색상 등 브랜딩 실제 값 적용 대기

## 4. 다음 개발 순서 (우선순위)

1. **콘텐츠 축적 운영** — 검증된 루프로 아티클 정기 발행 (플랫폼 개발보다 우선. 검색 노출은 시간 싸움)
2. **검색엔진 등록·성과 측정** — 구글 서치콘솔·네이버 서치어드바이저 사이트맵 등록, 색인·유입 모니터링
3. **두 번째 업체 사이트 실증** — create-site로 생성 → Cloudflare 두 번째 프로젝트(SITE 환경변수) → 다른 도메인 배포로 멀티 사이트 상용 검증
4. **지도·오시는길(location)** — 지역 검색 노출과 내원 전환용, hospital.json 확장
5. **의료진 소개(doctors 배열)** — 신뢰도·E-E-A-T 강화
6. **홈 섹션 순서/표시 제어(homeSections)** — 업체별 구성 차별화
7. **AI API 직접 연결** — draft 프롬프트를 그대로 재사용해 생성→등록 완전 자동화 (현재 프롬프트 품질 검증 단계)
8. **아티클 파일 분리** — 아티클 10개 초과 시 hospital.json에서 분리 검토

## 5. 최종 목표

**"업체 정보 입력 → 홈페이지 자동 생성 → AI 콘텐츠 지속 발행 → 자동 배포 →
검색 노출·성과 관리"까지 전 과정이 자동화된 다업체 SEO 플랫폼.**

- 신규 업체 1곳 추가 = JSON 1개 + Cloudflare 프로젝트 1개 (10~20분, 코드 수정 0줄)
- 템플릿 개선 1회 push = 전체 업체 사이트 동시 반영
- 콘텐츠는 AI 생성 + 시스템 자동 검증, 사람은 의료 내용 최종 검토만 담당
- 병원(비뇨의학과)에서 시작해 타 진료과·타 업종 템플릿으로 확장

## 참고 문서

- `docs/multi-site.md` — 멀티 사이트 구조·새 사이트 추가
- `docs/create-site.md` — 사이트 생성 CLI
- `docs/create-draft-prompt.md` — AI 프롬프트 생성
- `docs/import-ai-article.md` — AI 결과 자동 등록
- `docs/create-article.md` — 아티클 등록·Article Model v2 스키마

## 운영 원칙

- 도메인·병원 정보·콘텐츠의 단일 원천은 `sites/업체ID/hospital.json`
- 모든 배포는 `npm run build`(SEO 검사 포함)를 통과해야 함 — Cloudflare 빌드가 최종 기준
- 의료 콘텐츠는 게시 전 담당자(전문의) 검토 필수 — 시스템 검증은 기술적 검증임
- 치료 효과 보장·과장 표현 금지 (의료광고법 리스크 관리)
