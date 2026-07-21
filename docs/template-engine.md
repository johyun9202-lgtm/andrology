# 업종별 Template Engine — Registry (Phase 10)

병원 전용 구조를 범용 Website Platform으로 확장하기 위한 첫 단계로,
**업종별 템플릿 정의(Template Registry)** 를 도입했습니다.
이번 단계는 정의(Registry)까지만이며, 업종별 전용 UI는 다음 Phase입니다.

## 구조

```
templates/
  medical/template.json      ← 병원 (기본값)
  restaurant/template.json   ← 음식점
  lawyer/template.json       ← 법률사무소
  academy/template.json      ← 학원
  shopping/template.json     ← 쇼핑몰
  hospital/                  ← (별개 용도) create-site용 사이트 스캐폴드
                                template.json이 없으므로 Registry가 무시
```

각 템플릿은 `template.json` 하나만 가집니다:

```json
{
  "id": "medical",
  "name": "병원",
  "icon": "hospital",
  "description": "...",
  "sections": ["hero", "about", "services", "doctor", "articles", "hours", "faq", "cta"]
}
```

## Registry API (src/lib/templates.js)

| 함수 | 설명 |
|---|---|
| `getTemplates()` | 등록된 템플릿 전체 (폴더명 오름차순, template.json 없는 폴더 무시) |
| `getTemplate(id)` | 템플릿 1개 — 미등록 id는 **명확한 오류** (조용한 대체 없음) |
| `templateExists(id)` | 존재 여부 |
| `resolveTemplateId(raw)` | 사이트 데이터의 template 값 → id (없으면 `medical`) |
| `DEFAULT_TEMPLATE` | `'medical'` |

- templateId는 `^[a-z0-9]+(-[a-z0-9]+)*$`만 허용 — path traversal 불가
- 깨진 template.json·id/폴더명 불일치·빈 sections는 어느 파일인지 명시한 오류

## 사이트 데이터 연동 (하위 호환)

- `sites/<siteId>/hospital.json`에 **optional `template` 필드**를 지원합니다.
- 없으면 자동으로 `medical` → **기존 사이트(aiseolab, andrology)는 아무 변화 없음**
  (빌드 산출물 바이트 단위 동일 — 테스트로 증명).
- 로더(load-hospital.js)가 template을 검증·확정해 `hospital.template`으로 제공하며,
  등록되지 않은 값이면 빌드가 명확한 오류로 중단됩니다.
- index.astro는 Registry에서 현재 템플릿을 읽습니다. 현재는 모든 템플릿이
  medical 렌더링을 공유하며, 향후 template.sections 기반으로 분기합니다.

## 이번 단계에서 하지 않은 것 (의도적)

- Dashboard 업종 변경 UI 없음 (다음 Phase)
- restaurant/lawyer 등 전용 UI 없음 — 정의만 등록
- hospital.json 구조·AI 글 생성·게시·게시 글 관리·SEO 전부 무변경

## 테스트

- Registry: 목록 5종, medical 조회, 미등록/경로 조작 차단, 깨진 JSON 오류
- 로더: template 미설정 → medical / template="medical" 정상 / 미등록 값 → 오류
- 빌드: aiseolab·andrology 산출물이 변경 전과 **바이트 단위 동일**
- 기존 게시·SEO·회귀 테스트 전체 통과

## 다음 단계

1. Dashboard 사이트 설정에 업종 선택 추가 (template 필드 저장 — settings API의
   merge 전략이 이미 미지 필드를 보존하므로 필드 하나만 추가하면 됨)
2. index.astro를 template.sections 순서 기반 섹션 렌더링으로 전환
   (medical 출력은 동일하게 유지하는 스냅샷 테스트 포함)
3. 업종별 전용 섹션 컴포넌트 (menu / practice-areas / courses / products)
4. AI Writer 프롬프트의 업종별 어투·주의문(의료 광고 규정 등) 분기
