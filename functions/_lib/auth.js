// ============================================================
// Pages Functions 공통 유틸리티 (인증·응답·검증)
//
// Cloudflare Pages Functions(Workers 런타임)에서 실행됩니다.
// - Web Crypto API(HMAC-SHA256)만 사용 — Node 전용 API 없음
// - Secret은 환경변수(env.ADMIN_PASSWORD, env.SESSION_SECRET)로만 주입
// - 비밀번호·Secret·요청 본문을 로그로 출력하지 않습니다
// ============================================================

export const SESSION_COOKIE = 'aiseolab_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8 // 8시간

// 허용 사이트 목록 (sites/ 폴더 기준 — 새 사이트 추가 시 함께 갱신)
// TODO(확장): 빌드 시 sites/ 폴더에서 자동 생성하거나 D1로 이전
// 허용 사이트 목록 — sites/ 폴더 기준으로 빌드 시 생성되는 번들에서 파생 (Phase 11)
// 새 사이트를 생성하면 커밋 → 재배포 후 자동으로 이 목록에 포함됩니다.
import { SITE_DATA } from './site-data.generated.js'
export const ALLOWED_SITES = Object.keys(SITE_DATA).sort()

// ---------- 응답 도우미 ----------
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

export function methodNotAllowed() {
  return jsonResponse({ ok: false, error: '허용되지 않는 요청 방식입니다.' }, 405)
}

// ---------- 안전한 본문 파싱 ----------
// Content-Type이 JSON이 아니거나, 본문이 너무 크거나, 파싱 불가면 null 반환
export async function readJsonBody(request, maxBytes = 10_000) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    const text = await request.text()
    if (text.length > maxBytes) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------- 쿠키 ----------
export function parseCookies(request) {
  const header = request.headers.get('cookie') ?? ''
  const cookies = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx > 0) cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return cookies
}

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

// ---------- HMAC 세션 토큰 ----------
// 토큰 형식: base64url(만료시각ms).base64url(HMAC-SHA256(만료시각ms, SESSION_SECRET))
// 평문 비밀번호나 Secret은 토큰에 포함되지 않습니다.
const encoder = new TextEncoder()

function toBase64Url(bytes) {
  let binary = ''
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createSessionToken(secret) {
  const payload = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return `${toBase64Url(encoder.encode(payload))}.${toBase64Url(signature)}`
}

export async function verifySessionToken(secret, token) {
  if (typeof token !== 'string' || token.length > 512) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  let payload, signature
  try {
    payload = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))
    const sigBinary = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    signature = Uint8Array.from(sigBinary, (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false
  const key = await hmacKey(secret)
  // crypto.subtle.verify는 타이밍 공격에 안전한 비교를 수행합니다
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(payload))
}

// ---------- 인증 검사 ----------
export async function isAuthenticated(context) {
  const secret = context.env?.SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < 16) return false
  const token = parseCookies(context.request)[SESSION_COOKIE]
  if (!token) return false
  return verifySessionToken(secret, token)
}

// ---------- 상수 시간 문자열 비교 (비밀번호 검증용) ----------
export function timingSafeEqual(a, b) {
  const bytesA = encoder.encode(String(a))
  const bytesB = encoder.encode(String(b))
  const length = Math.max(bytesA.length, bytesB.length)
  let diff = bytesA.length === bytesB.length ? 0 : 1
  for (let i = 0; i < length; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0)
  }
  return diff === 0
}
