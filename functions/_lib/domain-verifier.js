// ============================================================
// Domain 검증 — DNS 조회(DoH) · HTTPS 검사 · 종합 판정 (Phase 14C)
//
// - DNS는 DNS-over-HTTPS(JSON)로 조회합니다. 리졸버 주소는 env.DNS_DOH_URL로
//   교체 가능(기본 Cloudflare 1.1.1.1) — 특정 서비스에 강하게 종속되지 않도록
//   응답을 표준 형태로 정규화해 사용합니다.
// - DNS 전파는 시간이 걸리므로 조회 실패/빈 응답은 오류가 아니라 pending입니다.
// - HTTPS 검사는 redirect를 수동으로 따라가며(최대 5회, 루프 감지),
//   각 이동 대상에 SSRF 가드를 적용합니다.
// - 테스트 전용 재정의: DNS_DOH_URL, DOMAIN_CHECK_BASE_URL (실서버 미설정)
// ============================================================

import { isForbiddenTarget } from './import-html.js'
import { compareDnsRecords } from './domain-dns.js'
import { computeVerificationStatus, computeDeployReady } from './domain-status.js'
import { isSameRegistrableDomain } from './domain-validate.js'
import { pagesStatusFor } from './cloudflare-pages.js'

const DEFAULT_DOH_URL = 'https://cloudflare-dns.com/dns-query'
const DNS_TYPE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 16: 'TXT', 28: 'AAAA' }
const MAX_REDIRECTS = 5

function timeoutMs(env, key, fallback) {
  const value = Number(env?.[key])
  return value > 0 ? value : fallback
}

// ---------- DNS 조회 (DoH JSON) ----------
// 반환: { status: 'ok'|'nxdomain'|'error', answers: [{type, value}] }
export async function resolveDns(env, name, type) {
  const base = typeof env?.DNS_DOH_URL === 'string' && env.DNS_DOH_URL.trim() !== '' ? env.DNS_DOH_URL.trim() : DEFAULT_DOH_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs(env, 'DNS_TIMEOUT_MS', 6000))
  try {
    const url = `${base}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/dns-json' },
    })
    if (!response.ok) return { status: 'error', answers: [] }
    const data = await response.json().catch(() => null)
    if (!data || typeof data.Status !== 'number') return { status: 'error', answers: [] }
    if (data.Status === 3) return { status: 'nxdomain', answers: [] } // NXDOMAIN
    if (data.Status !== 0) return { status: 'error', answers: [] }
    const answers = (Array.isArray(data.Answer) ? data.Answer : []).map((answer) => ({
      type: DNS_TYPE_NAMES[answer.type] ?? String(answer.type),
      value: String(answer.data ?? ''),
    }))
    return { status: 'ok', answers }
  } catch {
    return { status: 'error', answers: [] }
  } finally {
    clearTimeout(timer)
  }
}

// CNAME 우선 조회, 없으면 A 조회 결과 합침 (프록시/플래트닝 감지용)
export async function lookupDomainRecords(env, domain) {
  const cname = await resolveDns(env, domain, 'CNAME')
  if (cname.status === 'error') return cname
  if (cname.answers.some((answer) => answer.type === 'CNAME')) return cname
  const a = await resolveDns(env, domain, 'A')
  if (a.status === 'error') return { status: cname.status, answers: cname.answers } // CNAME 결과 기준 유지
  return {
    status: cname.status === 'nxdomain' && a.status === 'nxdomain' ? 'nxdomain' : 'ok',
    answers: [...cname.answers, ...a.answers],
  }
}

// ---------- HTTPS 검사 ----------
// 반환: { status: 'ok'|'pending'|'error', httpStatus, finalUrl, redirectTarget, mappingConfirmed, detail }
export async function checkHttps(env, domain) {
  const override = typeof env?.DOMAIN_CHECK_BASE_URL === 'string' ? env.DOMAIN_CHECK_BASE_URL.trim() : ''
  let url = override !== '' ? `${override.replace(/\/$/, '')}/${domain}/` : `https://${domain}/`
  const visited = new Set()
  let redirectTarget = ''

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (visited.has(url)) {
      return { status: 'error', httpStatus: 0, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: '리디렉션 루프가 감지되었습니다. 도메인 리디렉션 설정을 확인해 주세요.' }
    }
    visited.add(url)
    if (override === '') {
      const forbidden = isForbiddenTarget(url, [])
      if (forbidden) {
        return { status: 'error', httpStatus: 0, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: `허용되지 않는 주소로 이동했습니다. (${forbidden})` }
      }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs(env, 'DOMAIN_CHECK_TIMEOUT_MS', 8000))
    let response
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html', 'user-agent': 'aiseolab-domain-check/1.0' },
      })
    } catch (e) {
      clearTimeout(timer)
      const detail = e?.name === 'AbortError'
        ? '응답 시간을 초과했습니다. DNS 전파 또는 HTTPS 인증서 발급 대기 중일 수 있습니다.'
        : '아직 HTTPS로 접속되지 않습니다. DNS 전파·인증서 발급(수 분~수 시간) 후 다시 검증해 주세요.'
      return { status: 'pending', httpStatus: 0, finalUrl: url, redirectTarget, mappingConfirmed: false, detail }
    }
    clearTimeout(timer)

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? ''
      if (location === '') {
        return { status: 'error', httpStatus: response.status, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: `리디렉션 응답(HTTP ${response.status})에 대상이 없습니다.` }
      }
      let nextUrl
      try {
        nextUrl = new URL(location, url).toString()
      } catch {
        return { status: 'error', httpStatus: response.status, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: '리디렉션 대상 URL이 올바르지 않습니다.' }
      }
      if (redirectTarget === '') redirectTarget = nextUrl
      url = nextUrl
      continue
    }

    // 최종 응답
    let finalHost = ''
    try {
      finalHost = override !== ''
        ? (new URL(url).pathname.split('/').filter(Boolean).pop() ?? '') // 스텁 경로에서 도메인 복원
        : new URL(url).hostname
    } catch { finalHost = '' }
    const mappingConfirmed = finalHost !== '' && isSameRegistrableDomain(finalHost, domain)
    if (response.status >= 200 && response.status < 300) {
      return {
        status: 'ok', httpStatus: response.status, finalUrl: url, redirectTarget, mappingConfirmed,
        detail: mappingConfirmed ? `HTTPS 정상 응답 (HTTP ${response.status})` : `응답은 정상이지만 최종 도착지(${finalHost})가 등록 도메인과 다릅니다. 리디렉션 대상을 확인해 주세요.`,
      }
    }
    if (response.status === 404 || response.status === 522 || response.status === 530) {
      return { status: 'pending', httpStatus: response.status, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: `아직 사이트가 연결되지 않았습니다 (HTTP ${response.status}). Pages Custom Domain 연결·배포 후 다시 검증해 주세요.` }
    }
    return { status: 'error', httpStatus: response.status, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: `사이트가 오류를 반환했습니다 (HTTP ${response.status}).` }
  }
  return { status: 'error', httpStatus: 0, finalUrl: url, redirectTarget, mappingConfirmed: false, detail: `리디렉션이 ${MAX_REDIRECTS}회를 초과했습니다.` }
}

// ---------- 종합 검증 ----------
// connection: repository의 활성 도메인 행 (expectedDnsRecords 포함)
// 반환: 갱신할 필드 + 사람이 읽을 요약
export async function verifyDomain(env, connection) {
  const domain = connection.domain
  const lookup = await lookupDomainRecords(env, domain)
  const dns = compareDnsRecords(connection.expectedDnsRecords, lookup.answers, lookup.status)

  // DNS가 ok/manual일 때만 HTTPS·Pages 확인 (불필요한 외부 요청 최소화)
  let https = { status: 'unchecked', httpStatus: 0, finalUrl: '', redirectTarget: '', mappingConfirmed: false, detail: 'DNS 확인 후 검사합니다.' }
  let pages = { status: 'manual', detail: 'Cloudflare Dashboard에서 확인해 주세요.' }
  if (dns.status === 'ok' || dns.status === 'manual') {
    https = await checkHttps(env, domain)
    pages = await pagesStatusFor(env, domain)
  }

  const verificationStatus = computeVerificationStatus({
    domain,
    hasExpectedRecords: (connection.expectedDnsRecords ?? []).length > 0,
    dnsStatus: dns.status,
    httpsStatus: https.status,
    pagesStatus: pages.status,
  })
  const readiness = computeDeployReady({
    domain,
    dnsStatus: dns.status,
    httpsStatus: https.status,
    mappingConfirmed: https.status === 'ok' ? https.mappingConfirmed : false,
    operationMode: connection.operationMode,
    replacementApproved: connection.replacementApproved,
  })

  return {
    dnsStatus: dns.status,
    httpsStatus: https.status,
    pagesStatus: pages.status,
    verificationStatus,
    deployReady: readiness.ready,
    readinessReasons: readiness.reasons,
    actualDnsRecords: lookup.answers,
    detail: {
      dns: dns.detail,
      https: https.detail,
      pages: pages.detail,
      httpStatus: https.httpStatus,
      finalUrl: https.finalUrl,
      redirectTarget: https.redirectTarget,
    },
  }
}
