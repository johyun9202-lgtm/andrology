// ============================================================
// Import Extractor — 수집 페이지에서 필드 후보 추출 (Phase 14B)
//
// 순수 함수: pages = [{ url, html }] 를 받아 후보 목록을 만듭니다.
// 원칙:
//  - 페이지에 실제로 존재하는 값만 추출 (추측·생성 금지)
//  - 모든 후보에 sourceUrl(출처)과 sourceText(근거)를 남김
//  - confidence: high(JSON-LD·meta 등 명시적) / medium(패턴 일치) / low(휴리스틱)
// ============================================================

import {
  htmlToText, extractTitle, extractMetaTags, extractJsonLd, extractLinks,
  extractImages, findPhones, extractHoursFromText, normalizeImportUrl, isSameSite,
} from './import-html.js'

// 내부 페이지 우선 탐색 키워드 (앞일수록 우선) — 크롤러가 사용
export const PRIORITY_LINK_RULES = [
  ['doctors', /의료진|원장|의사소개|doctor|staff/i],
  ['about', /소개|인사말|병원안내|about|greeting/i],
  ['services', /진료과목|진료안내|클리닉|센터|시술|치료|clinic|treatment|subject/i],
  ['hours', /진료시간|시간안내|hours|schedule/i],
  ['location', /오시는|위치|찾아오|location|map|directions/i],
  ['reservation', /예약|reserv|booking/i],
  ['faq', /faq|자주\s*묻는|문의/i],
  ['facility', /시설|둘러보기|인테리어|장비|facility|tour/i],
]

// 같은 도메인 링크 중 우선순위 페이지를 골라 탐색 대상 결정 (중복 제거)
export function pickCrawlTargets(links, sourceUrl, maxTargets) {
  const ranked = []
  for (const link of links) {
    if (!link.url.startsWith('http') || !isSameSite(link.url, sourceUrl)) continue
    if (link.url === sourceUrl) continue
    const rank = PRIORITY_LINK_RULES.findIndex(([, pattern]) => pattern.test(link.text) || pattern.test(link.url))
    if (rank >= 0) ranked.push({ url: link.url, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank)
  const out = []
  const seen = new Set()
  for (const item of ranked) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item.url)
    if (out.length >= maxTargets) break
  }
  return out
}

// ---------- 내부 헬퍼 ----------

function extractHeadings(html) {
  const out = []
  const pattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi
  let match
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const text = htmlToText(match[2]).replace(/\n/g, ' ').trim()
    if (text !== '') out.push(text)
  }
  return out
}

function jsonLdOfType(blocks, pattern) {
  return blocks.find((block) => pattern.test(String(block['@type'] ?? '')))
}

function addressToString(address) {
  if (typeof address === 'string') return address.trim()
  if (address && typeof address === 'object') {
    return [address.addressRegion, address.addressLocality, address.streetAddress]
      .filter((part) => typeof part === 'string' && part.trim() !== '')
      .join(' ')
      .trim()
  }
  return ''
}

const KOREAN_ADDRESS =
  /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북도|충청남도|충북|충남|전라북도|전라남도|전북|전남|경상북도|경상남도|경북|경남|제주)[^\n]{2,50}(로|길)\s?\d+[^\n]{0,40}/

const SERVICE_TEXT = /(의학과|이비인후과|정형외과|내과|외과|피부과|안과|치과|한의원|소아청소년과|산부인과|신경과|재활|클리닉|센터)$|과\s?진료/
const TREATMENT_TEXT = /(시술|치료|수술|검사|재활|교정|관리)$|(염|증|통증|질환)\b/

// ---------- 메인: 후보 추출 ----------
// pages: [{ url, html }] (수집 성공 페이지만)
// 반환: candidates 배열 — 스칼라 필드는 1개, 배열 필드는 value가 배열
export function buildCandidates(pages, sourceUrl) {
  const candidates = []
  const add = (fieldKey, value, confidence, pageUrl, sourceText) => {
    candidates.push({ fieldKey, value, confidence, sourceUrl: pageUrl, sourceText: String(sourceText ?? '').slice(0, 160) })
  }
  const has = (fieldKey) => candidates.some((c) => c.fieldKey === fieldKey)

  const parsed = pages.map((page) => ({
    url: page.url,
    html: page.html,
    jsonLd: extractJsonLd(page.html),
    meta: extractMetaTags(page.html),
    title: extractTitle(page.html),
    text: htmlToText(page.html),
    links: extractLinks(page.html, page.url),
    images: extractImages(page.html, page.url),
    headings: extractHeadings(page.html),
  }))
  const main = parsed[0]

  // ----- 병원명 -----
  for (const page of parsed) {
    const org = jsonLdOfType(page.jsonLd, /Medical|Physician|Dentist|LocalBusiness|Organization|Hospital|Clinic/i)
    if (org && typeof org.name === 'string' && org.name.trim() !== '') {
      add('name', org.name.trim(), 'high', page.url, 'JSON-LD name')
      break
    }
  }
  if (!has('name') && main) {
    const siteName = main.meta['og:site_name'] ?? ''
    if (siteName.trim() !== '') add('name', siteName.trim(), 'high', main.url, 'og:site_name')
    else if (main.title !== '') {
      const first = main.title.split(/[|\-–—:]/)[0].trim()
      if (first !== '') add('name', first, 'low', main.url, `<title> ${main.title}`)
    }
  }

  // ----- 병원 소개 -----
  for (const page of parsed) {
    const description = page.meta['description'] ?? page.meta['og:description'] ?? ''
    if (description.trim().length >= 15) {
      add('description', description.trim().slice(0, 300), 'high', page.url, 'meta description')
      break
    }
  }

  // ----- 전화번호 -----
  outerPhone: for (const page of parsed) {
    const org = jsonLdOfType(page.jsonLd, /Medical|LocalBusiness|Organization|Hospital|Clinic|Dentist/i)
    if (org && typeof org.telephone === 'string') {
      const phones = findPhones(`<a href="tel:${org.telephone}"></a>`)
      if (phones.length > 0) {
        add('phone', phones[0].phone, 'high', page.url, 'JSON-LD telephone')
        break outerPhone
      }
    }
  }
  if (!has('phone')) {
    for (const page of parsed) {
      const phones = findPhones(page.html)
      if (phones.length > 0) {
        add('phone', phones[0].phone, phones[0].confidence, page.url, phones[0].confidence === 'high' ? 'tel: 링크' : '본문 전화번호 패턴')
        break
      }
    }
  }

  // ----- 주소 -----
  for (const page of parsed) {
    const org = jsonLdOfType(page.jsonLd, /Medical|LocalBusiness|Organization|Hospital|Clinic|Dentist/i)
    const address = org ? addressToString(org.address) : ''
    if (address !== '') {
      add('address', address.slice(0, 120), 'high', page.url, 'JSON-LD address')
      break
    }
  }
  if (!has('address')) {
    for (const page of parsed) {
      const match = page.text.match(KOREAN_ADDRESS)
      if (match) {
        add('address', match[0].trim().slice(0, 120), 'low', page.url, match[0].slice(0, 120))
        break
      }
    }
  }

  // ----- 진료시간 (평일/토요일/일·공휴일 + 휴진) -----
  const hoursKeys = { weekday: 'hoursWeekday', saturday: 'hoursSaturday', sundayHoliday: 'hoursSunday' }
  for (const page of parsed) {
    const hours = extractHoursFromText(page.text)
    for (const [key, fieldKey] of Object.entries(hoursKeys)) {
      if (!has(fieldKey) && hours[key]) add(fieldKey, hours[key].value, 'medium', page.url, hours[key].sourceText)
    }
  }

  // ----- 전환정보: 예약 / 지도 / 카카오 + SNS·약관 -----
  const allLinks = parsed.flatMap((page) => page.links.map((link) => ({ ...link, pageUrl: page.url })))
  const linkRules = [
    ['reservationUrl', (l) => /booking\.naver\.com|booking\./i.test(l.url), 'high', '네이버 예약 링크'],
    ['reservationUrl', (l) => /예약/.test(l.text) && l.url.startsWith('http'), 'medium', '예약 앵커 텍스트'],
    ['naverMapUrl', (l) => /map\.naver\.com|place\.naver\.com|naver\.me/i.test(l.url), 'high', '네이버 지도 링크'],
    ['kakaoUrl', (l) => /pf\.kakao\.com/i.test(l.url), 'high', '카카오채널 링크'],
    ['privacyUrl', (l) => /개인정보/.test(l.text), 'high', '개인정보처리방침 링크'],
    ['termsUrl', (l) => /이용약관/.test(l.text), 'high', '이용약관 링크'],
  ]
  for (const [fieldKey, test, confidence, why] of linkRules) {
    if (has(fieldKey)) continue
    const found = allLinks.find((l) => l.url.startsWith('http') && test(l))
    if (found) add(fieldKey, found.url, confidence, found.pageUrl, `${why}: ${found.text || found.url}`)
  }

  const snsRules = [
    ['blog', /blog\.naver\.com/i], ['instagram', /instagram\.com/i],
    ['facebook', /facebook\.com/i], ['youtube', /youtube\.com|youtu\.be/i],
  ]
  const sns = []
  for (const [type, pattern] of snsRules) {
    const found = allLinks.find((l) => pattern.test(l.url))
    if (found) sns.push({ type, url: found.url, sourceUrl: found.pageUrl })
  }
  if (sns.length > 0) add('snsLinks', sns, 'high', sns[0].sourceUrl, 'SNS/블로그 링크')

  // ----- 진료과목 / 시술·치료 (내비게이션·헤딩 텍스트 기반 후보) -----
  const services = []
  const treatments = []
  const seenText = new Set()
  for (const page of parsed) {
    const texts = [...page.headings, ...page.links.map((l) => l.text)]
    for (const raw of texts) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text.length < 2 || text.length > 24 || seenText.has(text)) continue
      if (SERVICE_TEXT.test(text)) {
        seenText.add(text)
        services.push({ title: text, sourceUrl: page.url })
      } else if (TREATMENT_TEXT.test(text)) {
        seenText.add(text)
        treatments.push({ title: text, sourceUrl: page.url })
      }
    }
  }
  if (services.length > 0) add('services', services.slice(0, 15), 'medium', services[0].sourceUrl, '메뉴·헤딩 텍스트')
  if (treatments.length > 0) add('treatments', treatments.slice(0, 15), 'medium', treatments[0].sourceUrl, '메뉴·헤딩 텍스트')

  // ----- FAQ -----
  for (const page of parsed) {
    const faqLd = jsonLdOfType(page.jsonLd, /FAQPage/i)
    const items = Array.isArray(faqLd?.mainEntity) ? faqLd.mainEntity : []
    const faq = items
      .map((item) => ({
        question: String(item?.name ?? '').trim(),
        answer: String(item?.acceptedAnswer?.text ?? '').trim(),
      }))
      .filter((item) => item.question !== '' && item.answer !== '')
    if (faq.length > 0) {
      add('faq', faq.slice(0, 10), 'high', page.url, 'JSON-LD FAQPage')
      break
    }
  }

  // ----- 의료진 -----
  const doctors = []
  const seenDoctor = new Set()
  for (const page of parsed) {
    for (const block of page.jsonLd) {
      if (!/Person|Physician/i.test(String(block['@type'] ?? ''))) continue
      const name = String(block.name ?? '').trim()
      if (name === '' || seenDoctor.has(name)) continue
      seenDoctor.add(name)
      doctors.push({
        name,
        title: String(block.jobTitle ?? '').trim(),
        image: typeof block.image === 'string' ? normalizeImportUrl(block.image, page.url) ?? '' : '',
        confidence: 'high',
        sourceUrl: page.url,
        sourceText: 'JSON-LD Person',
      })
    }
  }
  for (const page of parsed) {
    // 이미지 alt "홍길동 원장" 패턴 (JSON-LD가 없을 때의 보조 추출)
    for (const image of page.images) {
      const match = image.alt.match(/^([가-힣]{2,4})\s*(대표원장|병원장|원장|부원장|과장)/)
      if (!match || seenDoctor.has(match[1])) continue
      seenDoctor.add(match[1])
      doctors.push({
        name: match[1], title: match[2], image: image.url,
        confidence: 'medium', sourceUrl: page.url, sourceText: `이미지 alt: ${image.alt.slice(0, 60)}`,
      })
    }
    // 헤딩 "홍길동 원장" 패턴
    for (const heading of page.headings) {
      // 주의: 한글에는 \b(ASCII 단어 경계)가 동작하지 않으므로 사용하지 않음
      const match = heading.match(/^([가-힣]{2,4})\s*(대표원장|병원장|부원장|원장|과장)(?=$|[^가-힣])/)
      if (!match || seenDoctor.has(match[1])) continue
      seenDoctor.add(match[1])
      doctors.push({
        name: match[1], title: match[2], image: '',
        confidence: 'medium', sourceUrl: page.url, sourceText: `헤딩: ${heading.slice(0, 60)}`,
      })
    }
  }
  if (doctors.length > 0) add('doctors', doctors.slice(0, 10), 'medium', doctors[0].sourceUrl, '의료진 후보')

  // ----- 이미지: 로고 / 대표 / 시설 -----
  for (const page of parsed) {
    const logo = page.images.find((image) => /logo|로고/i.test(`${image.attrs} ${image.alt} ${image.url}`))
    if (logo) {
      add('logoImage', logo.url, 'medium', page.url, `로고 후보 (alt: ${logo.alt || '없음'})`)
      break
    }
  }
  if (main) {
    const ogImage = normalizeImportUrl(main.meta['og:image'] ?? '', main.url)
    if (ogImage) add('heroImage', ogImage, 'high', main.url, 'og:image')
  }
  const facility = []
  const seenImage = new Set(doctors.map((d) => d.image))
  for (const page of parsed) {
    const pageIsFacility = PRIORITY_LINK_RULES.find(([key]) => key === 'facility')[1].test(page.url + ' ' + page.title)
    for (const image of page.images) {
      if (seenImage.has(image.url) || facility.some((f) => f.url === image.url)) continue
      const altIsFacility = /시설|내부|인테리어|장비|대기실|진료실/.test(image.alt)
      if ((pageIsFacility || altIsFacility) && !/logo|로고|icon|btn/i.test(image.url + image.attrs)) {
        facility.push({ url: image.url, alt: image.alt, pageUrl: page.url })
      }
    }
  }
  if (facility.length > 0) add('facilityImages', facility.slice(0, 12), 'medium', facility[0].pageUrl, '시설 이미지 후보')

  // ----- 상세 진료 페이지 URL (참고용) -----
  const detailPages = []
  const seenDetail = new Set()
  for (const link of allLinks) {
    if (!isSameSite(link.url, sourceUrl) || seenDetail.has(link.url)) continue
    if (/진료|시술|치료|클리닉|센터/.test(link.text)) {
      seenDetail.add(link.url)
      detailPages.push({ url: link.url, text: link.text })
    }
  }
  if (detailPages.length > 0) add('detailPages', detailPages.slice(0, 15), 'medium', sourceUrl, '진료 관련 내부 페이지')

  return candidates
}
