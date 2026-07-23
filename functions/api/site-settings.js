// /api/site-settings — 병원 사이트 설정 조회(GET) / 저장(PUT)
//
// - 관리자 인증 필수
// - 원본은 GitHub 저장소의 sites/<site>/hospital.json (항상 최신을 읽음)
// - 저장은 "merge 전략": 편집 가능한 필드만 갱신하고,
//   articles / nav / home / footer / cta / faq / schema / site.url / hero.buttons 등
//   이 API가 모르는 필드는 전부 보존합니다. (전체 덮어쓰기 금지)
// - sha 기반 낙관적 잠금: 그 사이 파일이 바뀌면 409
// - 커밋 전 SEO 검사(runSeoCheck) — 오류가 있으면 커밋하지 않음 (빌드 보호)

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import {
  resolveGitHubConfig,
  githubFetch,
  githubErrorMessage,
  utf8ToBase64,
  base64ToUtf8,
} from '../_lib/publisher.js'
import { safeErrorMessage } from '../_lib/ai-writer.js'
import { runSeoCheck } from '../../scripts/lib/seo-checker.mjs'
import { isValidHttpUrl } from '../../src/lib/schema.js'
import { normalizeSiteUrl } from '../../src/lib/site-url.js'

const MAX_BODY_BYTES = 100_000
const MAX_SERVICES = 10

// ---------- 검증 도우미 ----------
const strip = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()

function textField(errors, value, label, { max, required = false } = {}) {
  const cleaned = strip(value)
  if (required && cleaned === '') errors.push(`${label}은(는) 비워둘 수 없습니다.`)
  if (max && cleaned.length > max) errors.push(`${label}은(는) ${max}자 이내여야 합니다.`)
  if (/[<>]/.test(cleaned)) errors.push(`${label}에 < > 문자는 사용할 수 없습니다.`)
  return cleaned
}

function urlField(errors, value, label) {
  const cleaned = strip(value)
  if (cleaned === '') return ''
  if (!isValidHttpUrl(cleaned)) {
    errors.push(`${label}은(는) http:// 또는 https:// 로 시작하는 주소여야 합니다.`)
    return ''
  }
  return cleaned
}

function phoneField(errors, value) {
  const cleaned = textField(errors, value, '전화번호', { max: 30 })
  if (cleaned !== '' && cleaned !== '미정' && !/^[0-9+\-() .가-힣]*$/.test(cleaned)) {
    errors.push('전화번호에 사용할 수 없는 문자가 있습니다.')
  }
  return cleaned
}

// 입력 → 검증된 "편집 필드" 객체. 오류가 있으면 { errors } 반환.
export function validateSettings(input) {
  const errors = []
  const s = input && typeof input === 'object' ? input : {}

  const out = {
    name: textField(errors, s.name, '병원명', { max: 60, required: true }),
    hospitalType: textField(errors, s.hospitalType, '병원 유형', { max: 30 }),
    region: textField(errors, s.region, '지역', { max: 50 }),
    address: textField(errors, s.address, '주소', { max: 120 }),
    phone: phoneField(errors, s.phone),
    description: textField(errors, s.description, '병원 소개', { max: 500, required: true }),
    heroTitle: textField(errors, s.heroTitle, '대표 문구', { max: 80, required: true }),
    heroSubtitle: textField(errors, s.heroSubtitle, '보조 문구', { max: 160 }),
    doctorName: textField(errors, s.doctorName, '대표원장 이름', { max: 30 }),
    doctorTitle: textField(errors, s.doctorTitle, '대표원장 직함', { max: 30 }),
    doctorBio: textField(errors, s.doctorBio, '대표원장 소개', { max: 500 }),
    hoursWeekday: textField(errors, s.hoursWeekday, '평일 운영시간', { max: 60 }),
    hoursSaturday: textField(errors, s.hoursSaturday, '토요일 운영시간', { max: 60 }),
    hoursSunday: textField(errors, s.hoursSunday, '일요일·공휴일 운영시간', { max: 60 }),
    consultUrl: urlField(errors, s.consultUrl, '상담 URL'),
    kakaoUrl: urlField(errors, s.kakaoUrl, '카카오 URL'),
    naverBookingUrl: urlField(errors, s.naverBookingUrl, '네이버 예약 URL'),
    naverMapUrl: urlField(errors, s.naverMapUrl, '네이버 지도 URL'),
    seoTitle: textField(errors, s.seoTitle, 'SEO 제목', { max: 70 }),
    seoDescription: textField(errors, s.seoDescription, 'SEO 설명', { max: 200 }),
    logoImage: urlField(errors, s.logoImage, '로고 이미지 URL'),
    heroImage: urlField(errors, s.heroImage, '대표 이미지 URL'),
    doctorImage: urlField(errors, s.doctorImage, '원장 이미지 URL'),
  }

  // SEO 키워드: 배열 또는 콤마 구분 문자열 (최대 10개, 각 30자)
  const rawKeywords = Array.isArray(s.seoKeywords)
    ? s.seoKeywords
    : String(s.seoKeywords ?? '').split(',')
  out.seoKeywords = rawKeywords.map((k) => strip(k)).filter((k) => k !== '').slice(0, 10)
  if (out.seoKeywords.some((k) => k.length > 30)) errors.push('SEO 키워드는 각 30자 이내여야 합니다.')

  // 주요 진료 분야: 1~10개, 각 항목 진료명(필수)+짧은 설명
  const services = Array.isArray(s.services) ? s.services : []
  if (services.length < 1) errors.push('주요 진료 분야는 최소 1개가 필요합니다.')
  if (services.length > MAX_SERVICES) errors.push(`주요 진료 분야는 최대 ${MAX_SERVICES}개까지 입력할 수 있습니다.`)
  out.services = services.slice(0, MAX_SERVICES).map((item, index) => ({
    title: textField(errors, item?.title, `진료 분야 ${index + 1}의 진료명`, { max: 40, required: true }),
    summary: textField(errors, item?.summary, `진료 분야 ${index + 1}의 설명`, { max: 120 }),
  }))

  // (Phase 12) optional: FAQ / CTA — 전달된 경우에만 검증·적용, 미전달 시 기존 값 유지
  if (s.faq !== undefined) {
    const faq = Array.isArray(s.faq) ? s.faq : []
    if (faq.length < 1 || faq.length > 10) errors.push('FAQ는 1~10개여야 합니다.')
    out.faq = faq.slice(0, 10).map((item, index) => ({
      question: textField(errors, item?.question, `FAQ ${index + 1} 질문`, { max: 120, required: true }),
      answer: textField(errors, item?.answer, `FAQ ${index + 1} 답변`, { max: 300, required: true }),
    }))
  }
  if (s.cta !== undefined) {
    const cta = s.cta && typeof s.cta === 'object' ? s.cta : {}
    out.cta = {
      label: textField(errors, cta.label, 'CTA 버튼 문구', { max: 30, required: true }),
      description: textField(errors, cta.description, 'CTA 설명', { max: 160 }),
    }
  }

  return errors.length > 0 ? { errors } : { settings: out }
}

// hospital.json 원본 → 편집 폼용 설정 추출 (doctor 문자열/객체 모두 지원)
export function extractSettings(hospital) {
  const doctor = hospital.doctor && typeof hospital.doctor === 'object' ? hospital.doctor : {}
  const hours = hospital.hours ?? {}
  const channels = hospital.channels ?? {}
  const seo = hospital.seo ?? {}
  const images = hospital.images ?? {}
  return {
    name: hospital.name ?? '',
    hospitalType: hospital.hospitalType ?? '',
    region: hospital.region ?? '',
    address: hospital.address ?? '',
    phone: hospital.phone ?? '',
    description: hospital.description ?? '',
    heroTitle: hospital.hero?.title ?? '',
    heroSubtitle: hospital.hero?.subtitle ?? '',
    doctorName: doctor.name ?? (typeof hospital.doctor === 'string' && hospital.doctor !== '미정' ? hospital.doctor : ''),
    doctorTitle: doctor.title ?? '',
    doctorBio: doctor.bio ?? '',
    hoursWeekday: hours.weekday ?? '',
    hoursSaturday: hours.saturday ?? '',
    hoursSunday: hours.sundayHoliday ?? hours.sunday ?? '',
    consultUrl: channels.consult ?? '',
    kakaoUrl: channels.kakao ?? '',
    naverBookingUrl: channels.naverBooking ?? '',
    naverMapUrl: channels.naverMap ?? '',
    seoTitle: seo.title ?? '',
    seoDescription: seo.description ?? '',
    seoKeywords: Array.isArray(seo.keywords) ? seo.keywords : [],
    logoImage: images.logo ?? '',
    heroImage: images.hero ?? '',
    doctorImage: images.doctor ?? '',
    services: (Array.isArray(hospital.services) ? hospital.services : []).map((svc) => ({
      title: svc?.title ?? '',
      summary: svc?.summary ?? '',
    })),
    faq: (Array.isArray(hospital.faq) ? hospital.faq : []).map((item) => ({
      question: item?.question ?? '',
      answer: item?.answer ?? '',
    })),
    cta: {
      label: hospital.cta?.label ?? '',
      description: hospital.cta?.description ?? '',
    },
  }
}

// 검증된 설정을 기존 hospital 객체에 merge (모르는 필드는 전부 보존)
export function mergeSettings(hospital, s) {
  const next = JSON.parse(JSON.stringify(hospital))
  next.name = s.name
  next.description = s.description
  next.address = s.address || '미정'
  next.phone = s.phone || '미정'
  if (s.hospitalType) next.hospitalType = s.hospitalType
  else delete next.hospitalType
  if (s.region) next.region = s.region
  else delete next.region

  next.hero = { ...(next.hero ?? {}) , title: s.heroTitle }
  if (s.heroSubtitle) next.hero.subtitle = s.heroSubtitle
  else delete next.hero.subtitle
  // hero.buttons 등 기존 확장 필드는 spread로 보존됨

  // doctor: 이름이 있으면 객체 형태로, 없으면 기존 값 유지
  if (s.doctorName) {
    next.doctor = { name: s.doctorName, title: s.doctorTitle || '대표원장' }
    if (s.doctorBio) next.doctor.bio = s.doctorBio
  }

  next.hours = {
    ...(next.hours ?? {}),
    weekday: s.hoursWeekday || '미정',
    saturday: s.hoursSaturday || '미정',
    sundayHoliday: s.hoursSunday || '미정',
  }
  delete next.hours.sunday // 구 필드 정리 (sundayHoliday로 통일)

  next.channels = {
    ...(next.channels ?? {}),
    kakao: s.kakaoUrl,
    naverBooking: s.naverBookingUrl,
    consult: s.consultUrl,
    naverMap: s.naverMapUrl,
  }

  next.images = { ...(next.images ?? {}), logo: s.logoImage, hero: s.heroImage, doctor: s.doctorImage }

  if (s.seoTitle || s.seoDescription || s.seoKeywords.length > 0) {
    next.seo = {}
    if (s.seoTitle) next.seo.title = s.seoTitle
    if (s.seoDescription) next.seo.description = s.seoDescription
    if (s.seoKeywords.length > 0) next.seo.keywords = s.seoKeywords
  } else {
    delete next.seo
  }

  // 진료 분야: slug는 기존 항목(제목 일치)에서 승계, 없으면 순번 기반 생성
  const existing = Array.isArray(hospital.services) ? hospital.services : []
  next.services = s.services.map((item, index) => {
    const match = existing.find((svc) => svc?.title === item.title && typeof svc?.slug === 'string')
    return { slug: match?.slug ?? `service-${index + 1}`, title: item.title, summary: item.summary }
  })

  // (Phase 12) optional: FAQ / CTA — 전달된 경우에만 교체 (미전달 시 기존 유지)
  if (s.faq) next.faq = s.faq
  if (s.cta) {
    next.cta = { ...(next.cta ?? {}), label: s.cta.label }
    if (s.cta.description) next.cta.description = s.cta.description
  }

  return next
}

// ---------- 공통: 사이트 결정 + GitHub 파일 읽기 ----------
function resolveSite(params) {
  const site = params.get('site') || 'aiseolab'
  return ALLOWED_SITES.includes(site) ? site : null
}

export async function readHospitalFile(config, site) {
  const filePath = `${config.basePath}/${site}/hospital.json`
  const response = await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${encodeURIComponent(config.branch)}`
  )
  if (!response.ok) throw new Error(githubErrorMessage(response.status, response.headers))
  const data = await response.json().catch(() => null)
  if (!data || typeof data.content !== 'string' || typeof data.sha !== 'string') {
    throw new Error('사이트 설정 파일을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  let hospital
  try {
    hospital = JSON.parse(base64ToUtf8(data.content))
  } catch {
    throw new Error('사이트 설정 파일을 해석하지 못했습니다. 파일 상태를 확인해 주세요.')
  }
  return { hospital, sha: data.sha, filePath }
}

// ---------- GET ----------
export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const site = resolveSite(new URL(context.request.url).searchParams)
  if (!site) return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const { hospital, sha } = await readHospitalFile(config, site)
    let siteUrl = ''
    try { siteUrl = normalizeSiteUrl(hospital.site?.url) } catch { /* 미설정 허용 */ }
    return jsonResponse({ ok: true, site, settings: extractSettings(hospital), sha, siteUrl })
  } catch (e) {
    return jsonResponse({ ok: false, error: safeErrorMessage(e) }, 500)
  }
}

// ---------- PUT ----------
export async function onRequestPut(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, MAX_BODY_BYTES)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }
  const site = typeof body.site === 'string' && ALLOWED_SITES.includes(body.site) ? body.site : null
  if (!site) return jsonResponse({ ok: false, error: '허용되지 않는 사이트입니다.' }, 400)

  const validated = validateSettings(body.settings)
  if (validated.errors) {
    return jsonResponse({ ok: false, error: validated.errors.slice(0, 3).join(' ') }, 400)
  }

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    const { hospital, sha, filePath } = await readHospitalFile(config, site)
    // 낙관적 잠금: 폼을 불러온 뒤 파일이 바뀌었으면 409
    if (typeof body.sha === 'string' && body.sha !== '' && body.sha !== sha) {
      return jsonResponse({ ok: false, error: '설정이 다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }, 409)
    }

    const merged = mergeSettings(hospital, validated.settings)

    // 커밋 전 SEO 검사 — 오류가 있으면 저장하지 않음 (빌드 실패 예방)
    const seoResult = runSeoCheck(merged, site, { print: false })
    if (seoResult.errors.length > 0) {
      return jsonResponse({ ok: false, error: `SEO 검사를 통과하지 못했습니다: ${strip(seoResult.errors[0])}` }, 422)
    }

    const newContent = JSON.stringify(merged, null, 2) + '\n'
    const putResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update site settings: ${site}`,
        content: utf8ToBase64(newContent),
        sha,
        branch: config.branch,
      }),
    })
    if (!putResponse.ok) throw new Error(githubErrorMessage(putResponse.status, putResponse.headers))
    const putResult = await putResponse.json().catch(() => null)
    const commitSha = putResult?.commit?.sha
    if (typeof commitSha !== 'string' || commitSha === '') {
      throw new Error('GitHub 커밋 결과를 확인하지 못했습니다. 저장소에서 커밋 이력을 확인해 주세요.')
    }

    let siteUrl = ''
    try { siteUrl = normalizeSiteUrl(merged.site?.url) } catch { /* 미설정 허용 */ }
    return jsonResponse({
      ok: true,
      site,
      commitSha,
      settings: extractSettings(merged),
      siteUrl,
      note: '저장되었습니다. Cloudflare 재배포(1~2분) 후 사이트에 반영됩니다.',
    })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[사이트 설정 저장 실패] site=${site} message=${message}`)
    const status = message.includes('충돌') || message.includes('변경되어') ? 409 : 500
    return jsonResponse({ ok: false, error: message }, status)
  }
}

export function onRequest() {
  return methodNotAllowed()
}
