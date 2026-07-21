// ============================================================
// Article Publisher (Cloudflare Pages Functions용) — Phase 7.5
//
// completed Job의 Article Model v2 결과를 개별 아티클 파일
// (sites/<siteId>/articles/<slug>.json)로 GitHub Contents API에 커밋합니다.
// 커밋되면 Cloudflare Pages가 자동으로 재배포합니다.
//
// Phase 7.5 전환 이유 (docs/article-storage-architecture.md 참고):
// - 단일 hospital.json 방식은 Contents API GET(base64)의 1MB 한도로
//   사이트당 약 230개에서 게시가 중단되는 구조였음
// - 개별 파일 방식은 "새 파일 PUT 1회"로 끝나 읽기-수정-쓰기·sha 경쟁이 없고
//   커밋 diff도 새 파일 하나(≈4KB)로 깨끗함
//
// 재사용 (기존 파이프라인과 형식 완전 일치):
// - 구조 검증: scripts/lib/article-validator.mjs (importer·로더와 동일)
// - 직렬화:   JSON.stringify(article, null, 2) + '\n'
// - URL 규칙: site.url + /articles/<slug>/ ([slug].astro와 동일)
// - 사이트 정보·기존 slug 목록: 빌드 시 생성되는 site-data.generated.js
//   (hospital.json 배열 + 개별 파일이 병합된 결과)
//
// 보안:
// - GITHUB_TOKEN은 env(Cloudflare Secret)로만 주입, 로그·응답·D1에 절대 저장 안 함
// - slug/사이트ID/경로는 전부 서버에서 검증·조립 (path traversal 불가)
// - sha 없는 PUT = 생성 전용 → 파일이 이미 있으면 GitHub가 409/422를 반환해
//   기존 파일을 덮어쓰는 일이 원천적으로 불가능
// ============================================================

import { validateArticle, isValidSlug } from '../../scripts/lib/article-validator.mjs'
import { sanitize } from '../../scripts/lib/prompt-builder.mjs'
import { normalizeSiteUrl } from '../../src/lib/site-url.js'
import { SITE_DATA } from './site-data.generated.js'

const DEFAULT_GITHUB_API_URL = 'https://api.github.com'
const DEFAULT_OWNER = 'johyun9202-lgtm'
const DEFAULT_REPO = 'andrology'
const DEFAULT_BRANCH = 'main'
const DEFAULT_BASE_PATH = 'sites' // hospital.json이 있는 저장소 내 기준 경로
const GITHUB_API_VERSION = '2022-11-28'
const DEFAULT_TIMEOUT_MS = 20_000

// 설정값 형식 검증 (경로 조작·헤더 주입 방지)
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/
const BASE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

function cleanEnvString(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : ''
  return v || fallback
}

// GitHub 설정 해석. 토큰이 없거나 설정값 형식이 잘못되면 ok:false + 안전한 메시지.
export function resolveGitHubConfig(env) {
  const token = typeof env?.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : ''
  if (token === '') {
    return { ok: false, error: '게시 저장소 연결이 설정되지 않았습니다. 관리자 설정(GITHUB_TOKEN Secret)이 필요합니다.' }
  }
  const owner = cleanEnvString(env?.GITHUB_OWNER, DEFAULT_OWNER)
  const repo = cleanEnvString(env?.GITHUB_REPO, DEFAULT_REPO)
  const branch = cleanEnvString(env?.GITHUB_BRANCH, DEFAULT_BRANCH)
  const basePath = cleanEnvString(env?.GITHUB_ARTICLE_BASE_PATH, DEFAULT_BASE_PATH).replace(/^\/+|\/+$/g, '')
  if (
    !NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo) ||
    !BRANCH_PATTERN.test(branch) || branch.includes('..') ||
    !BASE_PATH_PATTERN.test(basePath) || basePath.includes('..')
  ) {
    return { ok: false, error: '게시 저장소 설정값(GITHUB_OWNER/REPO/BRANCH/BASE_PATH)이 올바르지 않습니다.' }
  }
  const apiUrl = cleanEnvString(env?.GITHUB_API_URL, DEFAULT_GITHUB_API_URL).replace(/\/+$/, '')
  const timeoutMs = Number(env?.GITHUB_TIMEOUT_MS) > 0 ? Number(env.GITHUB_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
  return { ok: true, token, owner, repo, branch, basePath, apiUrl, timeoutMs }
}

// ---------- Workers 호환 UTF-8 ↔ base64 (Node Buffer 미사용) ----------

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToUtf8(base64) {
  const binary = atob(String(base64).replace(/\s+/g, '')) // GitHub 응답은 줄바꿈 포함
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// ---------- 게시용 SEO slug 생성 ----------
// 제목·키워드에서 영문/숫자 토큰을 추출해 slug를 만들고,
// (한글 키워드 등으로) 만들 수 없으면 날짜+Job 기반의 안전한 slug를 사용합니다.
// 충돌 시 자동으로 숫자를 붙이지 않고 명확한 오류로 알립니다. (slug 수정 UI는 향후 Phase)
export function generatePublishSlug(job, article) {
  const source = `${article?.title ?? ''} ${job?.title ?? ''} ${job?.keyword ?? ''}`
  const tokens = [...new Set( // 제목·키워드에서 겹치는 토큰 중복 제거 (순서 유지)
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  )]
  let slug = tokens.join('-').slice(0, 60).replace(/-+$/, '')
  if (slug.length >= 8 && isValidSlug(slug)) return slug

  const date = typeof article?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(article.date)
    ? article.date.replace(/-/g, '')
    : '00000000'
  const hex = String(job?.id ?? '').replace(/^job_/, '').replace(/[^0-9a-f]/g, '').slice(0, 8) || 'article'
  return `ai-${date}-${hex}`
}

// ---------- GitHub Contents API ----------

async function githubFetch(config, path, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    return await fetch(`${config.apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'aiseolab-publisher/1.0 (Cloudflare Pages Functions)',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error('GitHub 응답이 시간 안에 오지 않았습니다. 잠시 후 "게시 다시 시도"를 눌러 주세요.')
    }
    throw new Error('GitHub에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    clearTimeout(timer)
  }
}

// 상태 코드별 안전한 한국어 오류 (원문·토큰 미노출, 운영 로그용 상태 코드는 포함)
// isCreate=true: sha 없는 "생성 전용 PUT"에서의 409/422는 파일이 이미 존재한다는 뜻
function githubErrorMessage(status, headers, { isCreate = false, slug = '' } = {}) {
  if (status === 401) return 'GitHub 인증에 실패했습니다 (401). GITHUB_TOKEN이 유효한지 확인해 주세요.'
  if (status === 403) {
    if (headers?.get?.('x-ratelimit-remaining') === '0') {
      return 'GitHub API 호출 한도를 초과했습니다 (403). 잠시 후 다시 시도해 주세요.'
    }
    return 'GitHub 토큰 권한이 부족합니다 (403). 해당 저장소의 Contents: Read and write 권한이 필요합니다.'
  }
  if (status === 404) return '게시 저장소·브랜치·파일 경로를 찾을 수 없습니다 (404). GITHUB_OWNER/REPO/BRANCH 설정을 확인해 주세요.'
  if (status === 409 || status === 422) {
    if (isCreate) {
      return `이미 같은 slug("${slug}")의 아티클 파일이 저장소에 존재합니다. 기존 글을 확인해 주세요. (덮어쓰기는 하지 않습니다)`
    }
    return '저장소 파일이 게시 도중 변경되어 충돌이 발생했습니다. 잠시 후 "게시 다시 시도"를 눌러 주세요.'
  }
  return `GitHub API 오류 (HTTP ${status})가 발생했습니다. 잠시 후 다시 시도해 주세요.`
}

// ---------- 게시 본체 (Phase 7.5: 개별 파일 생성 전용) ----------
// 반환: { path, sha, url, slug } / 실패 시 사용자에게 안전한 메시지의 Error
export async function publishArticle(config, job, rawArticle) {
  // 1) slug 생성·검증 후 아티클 재검증 (importer·로더와 동일한 validator)
  const article = JSON.parse(JSON.stringify(rawArticle)) // 원본 불변
  const slug = generatePublishSlug(job, article)
  if (!isValidSlug(slug)) {
    throw new Error('게시용 slug를 생성하지 못했습니다. 작업 데이터를 확인해 주세요.')
  }
  article.slug = slug
  const { errors, article: cleanArticle } = validateArticle(article)
  if (errors.length > 0 || !cleanArticle) {
    const summary = errors.slice(0, 2).map((m) => sanitize(String(m))).join(' / ')
    throw new Error(`게시할 아티클이 형식 검증에 실패했습니다. (${summary || '구조 오류'})`)
  }

  // 2) 빌드 시점 사이트 데이터의 기존 slug와 선제 충돌 검사
  //    (hospital.json 배열 + 개별 파일이 병합된 목록 — 최종 판정은 아래 PUT이 담당)
  const siteData = SITE_DATA[job.site]
  const knownArticles = Array.isArray(siteData?.articles) ? siteData.articles : []
  const duplicate = knownArticles.find(
    (a) => typeof a?.slug === 'string' && a.slug.trim().toLowerCase() === cleanArticle.slug
  )
  if (duplicate) {
    throw new Error(`이미 같은 slug("${cleanArticle.slug}")의 아티클이 게시되어 있습니다. 기존 글을 확인해 주세요.`)
  }

  // 3) 개별 파일 생성 전용 PUT — sha를 보내지 않으므로 "새 파일 생성"만 가능하고,
  //    파일이 이미 있으면 GitHub가 409/422를 반환 → 덮어쓰기 원천 차단.
  //    경로는 서버가 검증된 값으로만 조립 (외부 입력이 경로에 들어가지 않음)
  const filePath = `${config.basePath}/${job.site}/articles/${cleanArticle.slug}.json`
  const fileContent = JSON.stringify(cleanArticle, null, 2) + '\n'
  const putResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Publish article: ${job.site}/${cleanArticle.slug} (${job.id})`,
      content: utf8ToBase64(fileContent),
      branch: config.branch,
    }),
  })
  if (!putResponse.ok) {
    throw new Error(githubErrorMessage(putResponse.status, putResponse.headers, { isCreate: true, slug: cleanArticle.slug }))
  }
  const putResult = await putResponse.json().catch(() => null)
  const commitSha = putResult?.commit?.sha
  const committedPath = putResult?.content?.path ?? filePath
  if (typeof commitSha !== 'string' || commitSha === '') {
    throw new Error('GitHub 커밋 결과를 확인하지 못했습니다. 저장소에서 커밋 이력을 확인해 주세요.')
  }

  // 4) 실제 라우트 규칙에 맞는 게시 URL 계산 (site.url + /articles/<slug>/)
  let url = `/articles/${cleanArticle.slug}/`
  try {
    url = `${normalizeSiteUrl(siteData?.site?.url)}/articles/${cleanArticle.slug}/`
  } catch {
    // site.url이 잘못된 경우 상대 경로만 저장 (게시 자체는 성공)
  }

  return { path: committedPath, sha: commitSha, url, slug: cleanArticle.slug }
}
