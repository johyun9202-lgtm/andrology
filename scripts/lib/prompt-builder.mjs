// ============================================================
// 아티클 작성 프롬프트 빌더
//
// draft-article(수동 붙여넣기용 프롬프트 파일)과
// write-article(AI Writer Engine 자동 호출)이 같은 프롬프트를 공유합니다.
// 프롬프트 규칙은 이 파일 한 곳에만 존재합니다.
// ============================================================

import { normalizeSiteUrl } from '../../src/lib/site-url.js'

// 프롬프트/파일 구조를 깨뜨릴 수 있는 입력 정리:
// 제어문자 제거 + 코드펜스(```)를 무해한 따옴표로 치환
export function sanitize(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/```/g, "'''")
    .trim()
}

// 로컬 기준 오늘 날짜 (YYYY-MM-DD)
export function localToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 작성 브리프(brief)와 사이트 데이터로 프롬프트 Markdown을 생성합니다.
// brief: { slug, mainKeyword, subKeywords, searchIntent, audience, purpose, targetLength, extraNotes }
export function buildArticlePrompt(hospital, brief, { today = localToday() } = {}) {
  const { slug, mainKeyword, subKeywords, searchIntent, audience, purpose, targetLength, extraNotes } = brief

  let siteUrl = ''
  try {
    siteUrl = normalizeSiteUrl(hospital.site?.url)
  } catch {
    siteUrl = '(사이트 URL 미설정)'
  }
  const services = (Array.isArray(hospital.services) ? hospital.services : [])
    .map((s) => `- ${s.title}${s.summary ? `: ${s.summary}` : ''}`)
    .join('\n') || '- (등록된 진료과목 없음)'
  const articleList = (Array.isArray(hospital.articles) ? hospital.articles : [])
    .map((a) => `- "${a.title}" (slug: ${a.slug})`)
    .join('\n') || '- (기존 아티클 없음 — relatedArticles는 빈 배열로 출력)'
  const siteFaq = (Array.isArray(hospital.faq) ? hospital.faq : [])
    .map((f) => `- ${f.question}`)
    .join('\n') || '- (사이트 FAQ 없음)'
  const isReal = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '미정'
  const contactNote = (!isReal(hospital.phone) || !isReal(hospital.address))
    ? '주의: 이 병원의 전화번호/주소는 아직 확정되지 않았습니다("미정"). 본문에 전화번호·주소·위치 정보를 사실처럼 쓰지 마세요.'
    : `참고: 병원 전화번호는 ${hospital.phone}, 주소는 ${hospital.address}입니다. 본문에 과도하게 반복하지 마세요.`
  const existingSlugList = (Array.isArray(hospital.articles) ? hospital.articles : [])
    .map((a) => a.slug)
    .filter(Boolean)
    .join(', ') || '(없음)'

  return `# 의료 SEO 아티클 작성 요청

## A. 역할

당신은 의료 SEO 콘텐츠 전문 작성자입니다. 다음 원칙을 반드시 지키세요.

- 의사의 진단을 대신하지 않습니다. 이 글은 정보 제공용 초안이며, 게시 전 전문의(병원 담당자) 검토가 필요합니다.
- 불안을 조장하거나, 치료 효과를 보장하거나, 과장된 표현을 사용하지 않습니다.
- 사실 확인이 필요한 수치·통계·가이드라인을 만들어내지 않습니다. 근거가 불확실하면 일반적인 표현으로 제한합니다.

## B. 사이트 정보

- 사이트명: ${sanitize(String(hospital.name ?? ''))}
- URL: ${siteUrl}
- 사이트 설명: ${sanitize(String(hospital.description ?? ''))}
- 진료과목:
${services}
- 기존 아티클 목록 (relatedArticles에는 아래 slug만 사용 가능):
${articleList}
- 사이트 FAQ (참고용 — 중복되는 질문은 이 글의 faq에 넣지 않기):
${siteFaq}
- ${contactNote}

## C. 글 작성 요청

- 핵심 키워드: ${mainKeyword}
- 보조 키워드: ${subKeywords || '(없음)'}
- 검색 의도: ${searchIntent}
- 대상 독자: ${audience}
- 글의 목적: ${purpose}
- 목표 분량: ${targetLength}
${extraNotes ? `- 추가 지시사항: ${extraNotes}` : ''}

## D. 콘텐츠 품질 기준

- 검색자가 가장 궁금해할 질문을 먼저 해결하는 구성으로 작성합니다.
- 키워드를 억지로 반복하지 않습니다.
- 제목과 요약은 구체적으로, 과장 없이 작성합니다.
- 의료 정보를 단정하지 말고 개인차가 있음을 안내합니다.
- 응급 상황이거나 진료가 필요한 경우에는 병원 방문을 적절히 안내합니다.
- 병원 광고성 표현을 과도하게 넣지 않습니다.
- 경쟁 병원이나 특정 의사를 비방하지 않습니다.
- 같은 내용을 반복해 분량을 채우지 않습니다.
- 일반 사용자가 이해하기 쉬운 한국어로 작성합니다.

## E. 출력 형식 (매우 중요)

최종 응답은 아래 구조의 **유효한 JSON 객체 하나만** 출력하세요.
설명, 인사말, 마크다운 코드펜스(백틱), 주석을 절대 붙이지 마세요.
응답의 첫 글자는 { 이고 마지막 글자는 } 여야 합니다.

{
  "slug": "${slug}",
  "title": "...",
  "summary": "...",
  "date": "${today}",
  "intro": "...",
  "sections": [
    {
      "heading": "...",
      "paragraphs": ["..."],
      "subsections": [
        {
          "heading": "...",
          "paragraphs": ["..."],
          "items": ["..."]
        }
      ]
    }
  ],
  "faq": [
    { "question": "...", "answer": "..." }
  ],
  "relatedArticles": []
}

규칙:

- slug는 반드시 "${slug}" 를 그대로 사용
- title은 15~60자
- summary는 50~160자
- date는 "${today}" 사용, updatedAt은 넣지 않음
- 본문은 sections만 사용 (content 필드는 만들지 않음)
- sections는 최소 3개 이상, 각 heading(H2)은 중복 금지
- subsections(H3)와 items(목록)는 필요할 때만 사용
- faq는 3~5개 (질문·답변 모두 실제 내용으로)
- relatedArticles에는 위 "기존 아티클 목록"의 slug만 사용 가능: ${existingSlugList}
- 적절한 관련 글이 없으면 relatedArticles는 빈 배열 []
- 모든 값에 HTML 태그, script, Markdown 문법을 넣지 않음
- 문자열 안에 줄바꿈(\\n)을 넣지 않음
- JSON 주석 금지, 후행 쉼표 금지

## F. 출력 전 자체 검수 (검수 결과는 응답에 출력하지 말 것)

출력 직전에 스스로 확인하세요: JSON 파싱 가능 여부 / slug가 "${slug}"와 정확히 일치하는지 /
필수 필드(slug, title, summary, sections) 누락 여부 / 제목·요약 길이 / H2·H3 중복 /
FAQ 중복 / HTML·script 포함 여부 / relatedArticles에 존재하지 않는 slug가 없는지 /
치료 효과 보장·단정적 진단 표현이 없는지 / 반복 문장으로 분량을 채우지 않았는지.
`
}

// ============================================================
// 네이버 블로그용 원고 프롬프트
//
// 사이트 아티클(buildArticlePrompt)과는 목적이 다릅니다:
// - 사이트 아티클: 이 사이트에 실제로 게시되는 SEO 페이지 (GitHub 커밋 → 배포)
// - 네이버 블로그 원고: 병원 담당자가 검토 후 "복사"해서 네이버 블로그 에디터에
//   직접 붙여넣는 초안입니다. 이 코드베이스는 네이버 블로그에 API로 직접
//   게시하지 않습니다(네이버 블로그는 공개된 글쓰기 API를 제공하지 않음).
//   따라서 출력은 HTML/링크가 섞이지 않은 순수 텍스트 문단 배열입니다.
// ============================================================
export function buildNaverBlogPrompt(hospital, brief, { today = localToday() } = {}) {
  const { keyword, title } = brief

  let siteUrl = ''
  try {
    siteUrl = normalizeSiteUrl(hospital.site?.url)
  } catch {
    siteUrl = '(사이트 URL 미설정)'
  }
  const services = (Array.isArray(hospital.services) ? hospital.services : [])
    .map((s) => `- ${s.title}${s.summary ? `: ${s.summary}` : ''}`)
    .join('\n') || '- (등록된 진료과목 없음)'
  const isReal = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '미정'
  const contactNote = (!isReal(hospital.phone) || !isReal(hospital.address))
    ? '주의: 이 병원의 전화번호/주소는 아직 확정되지 않았습니다("미정"). 본문에 전화번호·주소·위치 정보를 사실처럼 쓰지 마세요.'
    : `참고: 병원 전화번호는 ${hospital.phone}, 주소는 ${hospital.address}입니다.`

  return `# 네이버 블로그 원고 작성 요청

## A. 역할

당신은 의료기관 네이버 블로그 콘텐츠 전문 작성자입니다. 다음 원칙을 반드시 지키세요.

- 의사의 진단을 대신하지 않습니다. 이 글은 정보 제공용 초안이며, 게시 전 전문의(병원 담당자) 검토가 필요합니다.
- 불안을 조장하거나, 치료 효과를 보장하거나, 과장된 표현을 사용하지 않습니다("100% 완치", "부작용 없음" 등 금지).
- 사실 확인이 필요한 수치·통계·가이드라인을 만들어내지 않습니다.
- 경쟁 병원·특정 의사를 비방하지 않습니다.
- 의료법상 비급여 진료비용을 단정적으로 안내하지 않습니다(가격은 "상담을 통해 확인" 수준으로만 언급).

## B. 사이트/병원 정보

- 병원명: ${sanitize(String(hospital.name ?? ''))}
- 사이트: ${siteUrl}
- 병원 소개: ${sanitize(String(hospital.description ?? ''))}
- 진료과목:
${services}
- ${contactNote}

## C. 글 작성 요청

- 핵심 키워드: ${sanitize(keyword)}
- 제목 힌트: ${title ? sanitize(title) : '(없음 — AI가 제안)'}
- 매체: 네이버 블로그 (병원 공식/제휴 블로그에 담당자가 직접 게시할 원고)
- 목적: 이 키워드로 네이버에서 검색·조회되어, 잠재 환자가 병원에 대한 신뢰를 갖게 하는 것

## D. 네이버 블로그 콘텐츠 규칙 (사이트 아티클과 다름 — 반드시 지킬 것)

- 분량: 공백 포함 1,000~1,800자 (사이트 아티클보다 짧고 편한 호흡)
- 문체: 존댓말이되 딱딱한 백과사전식 설명이 아니라, 담당자가 환자에게 말하듯 자연스러운 블로그 어투
- 이모지는 사용하지 않거나 최소화(의료 콘텐츠 신뢰도를 해치지 않는 선)
- 소제목(H2/H3) 없이, 짧은 문단(2~4문장) 여러 개로 자연스럽게 이어지는 구성
- hook(도입부 2~3문장)은 네이버 모바일 검색 결과 미리보기에 그대로 노출되므로,
  키워드를 자연스럽게 포함하면서 클릭하고 싶게 만드는 문장으로 작성
- 본문 중간중간 사진이 들어갈 만한 지점을 photoGuide로 별도 안내(실제 이미지는 만들지 않음,
  "어떤 사진을 어디에 넣으면 좋은지"에 대한 텍스트 가이드만 작성)
- hashtags는 10~15개: 병원명, 지역, 핵심 키워드, 관련 증상/진료과목 키워드를 조합
  (모두 "#" 없이 단어만 — 실제 삽입 시 "#"은 게시자가 붙임)
- 링크, HTML 태그, 마크다운 문법을 절대 넣지 않습니다(네이버 블로그 에디터에 그대로 복사·붙여넣기 되므로)

## E. 출력 형식 (매우 중요)

최종 응답은 아래 구조의 **유효한 JSON 객체 하나만** 출력하세요.
설명, 인사말, 마크다운 코드펜스(백틱), 주석을 절대 붙이지 마세요.
응답의 첫 글자는 { 이고 마지막 글자는 } 여야 합니다.

{
  "title": "...",
  "hook": "...",
  "paragraphs": ["...", "...", "..."],
  "photoGuide": ["...", "..."],
  "hashtags": ["...", "..."]
}

규칙:

- date는 별도로 넣지 않음 (게시 시점 기준으로 담당자가 직접 관리)
- title은 네이버 블로그 제목 스타일로 20~40자 (사이트 아티클 title 규칙과 다름)
- hook은 40~120자, 본문 paragraphs의 내용을 반복하지 않는 별도의 도입 문장
- paragraphs는 4~8개, 각 항목은 문단 하나(내부에 줄바꿈 \\n 넣지 않음)
- photoGuide는 2~5개 (예: "병원 외관 또는 진료실 사진", "상담 중인 모습(초상권 동의된 사진만)")
- hashtags는 10~15개, "#" 기호 없이 단어만, 중복 없이
- 모든 값에 HTML 태그, script, Markdown 문법을 넣지 않음
- 날짜(오늘: ${today})는 참고용일 뿐 출력 필드에는 포함하지 않음

## F. 출력 전 자체 검수 (검수 결과는 응답에 출력하지 말 것)

출력 직전에 스스로 확인하세요: JSON 파싱 가능 여부 / paragraphs 각 항목에 줄바꿈이 없는지 /
분량이 1,000~1,800자 범위에 가까운지 / 과장·효과 보장 표현이 없는지 / hashtags에 "#"이
섞여 있지 않은지 / hashtags 개수가 10~15개인지 / HTML·script·마크다운이 섞여 있지 않은지.
`
}
