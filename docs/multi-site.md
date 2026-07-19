# 멀티 사이트 운영 가이드

하나의 코드(템플릿)로 여러 업체 사이트를 만드는 구조입니다.
업체 하나 = `sites/` 아래 폴더 하나 = `hospital.json` 파일 하나.

## 폴더 구조

```
sites/
  andrology/
    hospital.json     ← andrology.co.kr 데이터
  (새업체ID)/
    hospital.json     ← 새 업체 데이터
```

## 사이트 ID 규칙

- 영문 소문자, 숫자, 하이픈만 사용 (예: `andrology`, `dental-example`)
- 폴더 이름 = 사이트 ID = SITE 환경변수 값
- **기본 사이트는 `andrology`** — SITE를 지정하지 않으면 항상 andrology가 빌드됩니다.

## 새 사이트 추가 방법

1. `sites/새업체ID/` 폴더를 만든다.
2. 기존 `sites/andrology/hospital.json`을 복사해 넣고 내용을 새 업체 정보로 수정한다.
   (`site.url`은 반드시 새 업체 도메인으로 변경)
3. 아래 방법으로 SITE를 지정해 검사·빌드한다.

필수 구조가 맞는지는 `npm run check:seo`(빌드 시 자동 실행)가 검증합니다.
필수값이 빠지면 빌드가 실패하므로 잘못된 사이트가 배포되지 않습니다.

## SITE 환경변수 설정 방법

Windows CMD:

```
set SITE=andrology && npm run build
```

PowerShell:

```
$env:SITE="andrology"; npm run build
```

Linux / Mac / Cloudflare Pages 빌드:

```
SITE=andrology npm run build
```

## Cloudflare Pages 설정

- 기존 andrology 프로젝트: **아무 설정도 바꿀 필요 없음** (SITE 미지정 = andrology)
- 새 업체 배포: Cloudflare Pages에서 같은 GitHub 저장소로 새 프로젝트를 만들고
  - 빌드 명령: `npm run build`
  - 출력 디렉터리: `dist`
  - 환경변수: `SITE` = `새업체ID`
  - 해당 업체 도메인을 프로젝트에 연결

## 참고

- 데이터 접근은 `src/lib/site-data.js` 한 곳에서만 처리합니다.
- 잘못된 SITE 값(허용 외 문자, 없는 폴더)은 빌드가 시작 단계에서 명확한 오류로 중단됩니다.
- 개발 서버(`npm run dev`) 사용 중 hospital.json을 수정했다면 서버를 재시작해야 반영됩니다.
