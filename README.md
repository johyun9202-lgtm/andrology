# andrology.co.kr

AI SEO 병원 홈페이지 자동 생성 플랫폼 — Astro 정적 사이트 템플릿

핵심 개념: **`src/data/hospital.json` 한 파일만 교체하면 모든 페이지가 해당 병원 사이트로 자동 변경**됩니다.

## 실행 방법

```bash
npm install     # 최초 1회
npm run dev     # 개발 서버 → http://localhost:4321/
npm run build   # 프로덕션 빌드 → dist/
npm run preview # 빌드 결과 확인
```

## 데이터 구조

- `src/data/hospital.json` — 병원명, 소개, 전화, 주소, 운영시간, 대표원장, Hero 문구, 상담(CTA) 문구, services[], faq[], articles[]
- `src/config/site.js` — 도메인(siteUrl), 헤더 메뉴 등 사이트 인프라 설정

## 폴더 구조

```
src/
├─ data/hospital.json    ← 병원별 교체 데이터 (단일 소스)
├─ config/site.js        ← 도메인·메뉴 설정
├─ layouts/BaseLayout.astro  ← 공통 레이아웃 + SEO 메타 자동 생성
├─ components/           ← Header, Footer, Hero, ServiceCard,
│                           FaqList, ContactBox, PageTitle
├─ styles/global.css
└─ pages/                ← index, services, faq, articles, contact, privacy
```

## SEO

- 페이지 title 자동 생성: `병원명 | 섹션명` (hospital.json 기반)
- meta description / canonical 자동 생성
- `robots.txt` + 빌드 시 `sitemap-index.xml` 자동 생성

## 배포 (Cloudflare Pages)

- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
