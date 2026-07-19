# 새 사이트 생성 가이드 (create-site)

병원 템플릿(`templates/hospital`)을 기반으로 새 업체 사이트 데이터를 만드는 명령입니다.

## 실행 방법

```
npm run create-site
```

## 입력 항목 (순서대로)

1. 사이트 ID — 영문 소문자·숫자·하이픈만 (예: `gwangju-clinic`)
2. 병원명
3. 사이트 URL — `https://` 또는 `http://`로 시작하는 절대 주소만 허용, 끝 슬래시는 자동 정리
4. 전화번호
5. 주소

잘못된 사이트 ID나 URL을 입력하면 오류 안내 후 다시 입력받습니다.
나머지 항목(소개 문구, 진료과목, FAQ, 아티클 등)은 템플릿 기본값으로 채워지며,
생성 후 `sites/사이트ID/hospital.json`에서 직접 수정하면 됩니다.

## 생성 위치

```
sites/
  사이트ID/
    hospital.json
```

## 안전 규칙

- **기존 사이트는 절대 덮어쓰지 않습니다.** 같은 ID가 있으면 오류로 종료됩니다.
- 생성 직후 SEO 검사가 자동 실행됩니다.
  - 경고만 있으면 생성 성공
  - 오류가 있으면 생성 파일을 자동 삭제하고 실패 처리

## 생성한 사이트 로컬 실행

Windows CMD:

```
set SITE=사이트ID && npm run dev
```

PowerShell:

```
$env:SITE="사이트ID"; npm run dev
```

Linux / macOS:

```
SITE=사이트ID npm run dev
```

## Cloudflare Pages 배포

1. Cloudflare Pages에서 같은 GitHub 저장소로 새 프로젝트 생성
2. 빌드 명령 `npm run build`, 출력 디렉터리 `dist`
3. 환경변수 `SITE` = 생성한 사이트 ID
4. 업체 도메인 연결

자세한 멀티 사이트 구조는 `docs/multi-site.md` 참고.

## 다음 단계

사이트 생성 후 아티클(콘텐츠) 등록은 `npm run create-article` 명령을 사용합니다.
→ `docs/create-article.md` 참고.
