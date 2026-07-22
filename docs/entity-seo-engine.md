# Doctor & Department Entity Engine (Phase 13)

병원·진료과·의료진 정보를 구조화된 페이지와 데이터로 자동 생성하는
**내부 SEO 운영 도구**입니다. 병원 원장이 직접 쓰는 제작 도구가 아니라,
운영자가 고객 병원의 정보를 입력하면 검색엔진(네이버 포함)이
병원 내부 엔티티 관계를 **이해할 수 있는 기반**을 만드는 시스템입니다.

> 구조화 데이터와 페이지 구조는 검색엔진의 이해를 돕는 기반이며,
> **검색 노출을 보장하지 않습니다.**

## 데이터 구조 (hospital.json — optional 추가)

```
departments[]: { id(slug), name*, shortDescription, description, image, phone,
                 consultationUrl, doctorIds[], seo{title, description, keywords[]} }
doctors[]:     { id(slug), name*, title, departmentIds[], specialties[], bio,
                 career[], education[], certifications[], image, imageAlt,
                 consultationUrl, seo{...} }
```

- 관계는 ID로 연결 — 의료진 1명이 여러 진료과에, 진료과에 여러 의료진 연결 가능
- 저장 시 **양방향 관계를 자동 동기화**(합집합 기준, 중복 제거)해 불일치가 발생하지 않음
- 기존 단일 `doctor` 필드(대표원장 legacy)는 그대로 유지되며 충돌하지 않음
- 다른 모든 필드(articles/nav/schema/theme/faq/cta 등) 보존 (merge 저장)
- **경력·자격·학력은 운영자가 입력한 항목만 저장·표시** — AI·시스템이 임의 생성하지 않음

## 페이지 URL 구조

| URL | 내용 | 생성 조건 |
|---|---|---|
| /departments | 진료과 목록 (ItemList) | departments 1개 이상 |
| /departments/&lt;slug&gt; | 진료과 상세 | 각 항목 |
| /doctors | 의료진 목록 (ItemList) | doctors 1명 이상 |
| /doctors/&lt;slug&gt; | 의료진 상세 | 각 항목 |

동적 라우트라 **데이터가 없으면 페이지가 아예 생성되지 않고**(빌드 정상),
엔티티를 삭제하면 다음 빌드에서 페이지·sitemap에서 자동 제거됩니다.
모든 페이지는 고유 title/description, canonical, og:title/description/og:image,
breadcrumb(화면+schema), 내부 링크(진료과↔의료진↔다른 항목)를 가지며,
JavaScript 없이 핵심 정보를 확인할 수 있는 정적 HTML입니다.
빈 값은 화면에 빈 섹션으로 표시되지 않습니다.

## Dashboard 사용법 (SEO 엔티티 탭)

사이트 선택 → 진료과/의료진 추가·수정·삭제 → **[전체 저장]** → GitHub 커밋
(커밋 SHA 표시) → 재배포(1~2분) 후 페이지 반영. 항목별로 생성될 페이지 URL이
표시되고, 사진 미리보기(로드 실패 시 오류 표시), 연결 상태 표시,
연결된 항목 삭제 시 경고를 제공합니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/entities?site= | departments/doctors + sha + siteUrl |
| PUT | /api/entities | `{site, sha, departments, doctors}` → 검증·정규화 → merge 커밋 |

관리자 인증 필수, site allowlist, **medical 템플릿 사이트만 허용**.
검증: slug `^[a-z0-9-]+$`(2~40자)·중복 차단, 참조 ID 존재 확인, 길이 제한,
URL은 http/https만(javascript:/data:/file: 차단), script 패턴 차단,
sha 기반 동시 수정 409. GitHub Publisher 헬퍼 재사용, 토큰 미노출.

## 구조화 데이터 (src/lib/schema/entity-schema.js)

- 목록: ItemList(ListItem position/name/url/image)
- 진료과 상세: MedicalClinic(+parentOrganization: MedicalOrganization) + BreadcrumbList + 소속 의료진 ItemList
- 의료진 상세: Person(name/jobTitle/image/url/knowsAbout/worksFor: MedicalOrganization) + BreadcrumbList

실제 데이터가 있는 필드만 출력, 절대 URL만 사용, 본문 내용과 일치,
기존 사이트 대표 스키마·FAQ 스키마와 별개 객체로 충돌 없음.

## 이미지 등록 원칙

URL 등록만 지원(업로드는 향후). http/https만 허용, 로드 실패 시 대시보드에서
오류 표시, 화면에서는 이미지가 없으면 이니셜 placeholder 사용(깨진 이미지 없음).
모든 이미지에 의미 있는 alt(미입력 시 "이름 직책 사진" 형태 자동), og:image와
Person.image에 동일한 실제 사진 사용. 로고를 의료진 사진으로 자동 사용하지 않습니다.

## sitemap / 네이버 검색과의 관계

엔티티 페이지는 빌드 시 자동으로 sitemap.xml에 포함되고(SITE별 절대 URL),
삭제 시 다음 빌드에서 제거됩니다. robots.txt는 기존 동작 그대로입니다.
이번 단계는 네이버 Search Advisor·API 연동 없이, 독립 URL·고유 메타·구조화
데이터·내부 링크·sitemap 등 **검색엔진이 정보를 이해할 수 있는 기반**을 마련합니다.

## 테스트 방법

검증·API 24종 + 페이지·스키마·sitemap 23종(실데이터 주입 빌드) + UI 12종 +
전체 회귀 — 모두 스텁 기반이며 외부 API를 호출하지 않습니다.

## 알려진 제한 / 향후

- AI 보조 문구 다듬기는 이번 범위에서 제외(Phase 12 생성 API 구조를 재사용해 추가 가능)
- 이미지 업로드·AI 이미지 생성 없음 (URL 방식)
- Disease/Treatment 엔티티는 동일 패턴(배열+ID 연결+동적 라우트)으로 확장 가능하도록
  설계되어 있으며 본격 구현은 향후 Phase
- Search Advisor·IndexNow 연동, 예약·후기 기능은 향후 Phase
