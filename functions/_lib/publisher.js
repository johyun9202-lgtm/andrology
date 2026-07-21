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

export async function githubFetch(config, path, init = {}) {
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
export function githubErrorMessage(status, headers, { isCreate = false, slug = '' } = {}) {
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

// ============================================================
// Phase 8 — 게시 글 관리 (읽기 / 수정 / 삭제) + 배포 확인
// ============================================================

// D1에 저장된 published_path가 이 엔진이 만든 개별 아티클 파일인지 검증.
// (레거시 hospital.json 경로·임의 경로는 관리 대상에서 제외)
const ARTICLE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/([a-z0-9-]+)\/articles\/([a-z0-9-]+)\.json$/

export function parseArticlePath(publishedPath) {
  const match = typeof publishedPath === 'string' ? publishedPath.match(ARTICLE_PATH_PATTERN) : null
  if (!match) return null
  const [, site, slug] = match
  if (!isValidSlug(slug)) return null
  return { site, slug }
}

const MAX_REMOTE_FILE_SIZE = 512 * 1024 // 개별 아티클 파일 크기 상한 (안전장치)

// GitHub에서 개별 아티클 파일 읽기 → { text, sha }
export async function githubReadArticleFile(config, filePath) {
  const getPath = `/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${encodeURIComponent(config.branch)}`
  const response = await githubFetch(config, getPath)
  if (!response.ok) throw new Error(githubErrorMessage(response.status, response.headers))
  const data = await response.json().catch(() => null)
  if (!data || typeof data.sha !== 'string' || typeof data.content !== 'string' || data.content === '') {
    throw new Error('저장소의 아티클 파일을 읽지 못했습니다. 파일 상태를 확인해 주세요.')
  }
  if (Number(data.size) > MAX_REMOTE_FILE_SIZE) {
    throw new Error('아티클 파일이 허용 크기를 초과합니다.')
  }
  return { text: base64ToUtf8(data.content), sha: data.sha }
}

// 게시 글 수정: 검증 → 현재 파일 GET(sha) → 동일 내용이면 커밋 생략 → sha 기반 PUT
// 반환: { sha(새 커밋), path, article } / noChange=true면 { noChange: true }
export async function updatePublishedArticle(config, job, rawArticle) {
  const parsed = parseArticlePath(job.publishedPath)
  if (!parsed) {
    throw new Error('이 작업의 게시 파일 경로가 관리 대상 형식이 아닙니다. (개별 아티클 파일만 수정할 수 있습니다)')
  }

  // slug·사이트는 D1의 검증된 값으로 강제 — 사용자 입력이 경로에 관여하지 않음
  const article = JSON.parse(JSON.stringify(rawArticle))
  article.slug = parsed.slug
  const { errors, article: cleanArticle } = validateArticle(article)
  if (errors.length > 0 || !cleanArticle) {
    const summary = errors.slice(0, 2).map((m) => sanitize(String(m))).join(' / ')
    throw new Error(`수정한 아티클이 형식 검증에 실패했습니다. (${summary || '구조 오류'})`)
  }

  const current = await githubReadArticleFile(config, job.publishedPath)
  const newContent = JSON.stringify(cleanArticle, null, 2) + '\n'
  // 동일 내용이면 불필요한 커밋 생략 — 문자열이 아니라 "정규화된 의미" 기준으로 비교
  // (validator가 키 순서·공백을 정리하므로 원문 문자열 비교는 오탐이 생길 수 있음)
  try {
    const currentValidated = validateArticle(JSON.parse(current.text)).article
    if (currentValidated && JSON.stringify(currentValidated) === JSON.stringify(cleanArticle)) {
      return { noChange: true }
    }
  } catch {
    // 현재 파일 해석 불가 시 비교 생략하고 수정 진행 (파일 정상화 효과)
  }

  const putResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${job.publishedPath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update article: ${parsed.site}/${parsed.slug} (${job.id})`,
      content: utf8ToBase64(newContent),
      sha: current.sha, // 수정은 반드시 현재 sha 기반 — 그 사이 변경되면 409/422
      branch: config.branch,
    }),
  })
  if (!putResponse.ok) throw new Error(githubErrorMessage(putResponse.status, putResponse.headers))
  const putResult = await putResponse.json().catch(() => null)
  const commitSha = putResult?.commit?.sha
  if (typeof commitSha !== 'string' || commitSha === '') {
    throw new Error('GitHub 커밋 결과를 확인하지 못했습니다. 저장소에서 커밋 이력을 확인해 주세요.')
  }
  return { sha: commitSha, path: job.publishedPath, article: cleanArticle }
}

// 게시 글 삭제: 현재 파일 GET(sha) → sha 기반 DELETE (커밋 이력은 남아 복구 가능)
export async function deletePublishedArticle(config, job) {
  const parsed = parseArticlePath(job.publishedPath)
  if (!parsed) {
    throw new Error('이 작업의 게시 파일 경로가 관리 대상 형식이 아닙니다. (개별 아티클 파일만 삭제할 수 있습니다)')
  }
  const current = await githubReadArticleFile(config, job.publishedPath)
  const deleteResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${job.publishedPath}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Delete article: ${parsed.site}/${parsed.slug} (${job.id})`,
      sha: current.sha,
      branch: config.branch,
    }),
  })
  if (!deleteResponse.ok) throw new Error(githubErrorMessage(deleteResponse.status, deleteResponse.headers))
  const deleteResult = await deleteResponse.json().catch(() => null)
  const commitSha = deleteResult?.commit?.sha
  if (typeof commitSha !== 'string' || commitSha === '') {
    throw new Error('GitHub 삭제 커밋을 확인하지 못했습니다. 저장소에서 커밋 이력을 확인해 주세요.')
  }
  return { sha: commitSha }
}

// ------------------------------------------------------------
// 배포 확인 (SSRF 방지 설계)
//
// 요청 URL은 사용자·D1의 published_url을 그대로 쓰지 않고,
// "빌드에 포함된 사이트 설정(site.url) + 검증된 slug"로만 서버가 조립합니다.
// → localhost/사설 IP/임의 도메인 요청이 구조적으로 불가능.
// redirect 발생 시 최종 URL도 허용 origin 안인지 확인합니다.
// 응답 본문은 저장하지 않으며 상태·시각만 D1에 기록됩니다.
// ------------------------------------------------------------

const DEPLOY_CHECK_TIMEOUT_MS = 10_000

// 검사 대상 URL 계산: 허용 origin(사이트 설정) + slug — 실패 시 null
export function buildDeployCheckUrl(env, job) {
  const parsed = parseArticlePath(job.publishedPath)
  if (!parsed || parsed.site !== job.site) return null
  // 테스트 전용 재정의(DEPLOY_CHECK_BASE_URL) — 미설정 시 사이트 설정의 URL 사용
  const override = typeof env?.DEPLOY_CHECK_BASE_URL === 'string' ? env.DEPLOY_CHECK_BASE_URL.trim() : ''
  let origin
  try {
    origin = normalizeSiteUrl(override || SITE_DATA[job.site]?.site?.url)
  } catch {
    return null
  }
  return { url: `${origin}/articles/${parsed.slug}/`, origin, slug: parsed.slug }
}

// 배포 상태 실제 확인. 반환: { status: 'deployed'|'pending'|'deploy_failed', note }
export async function checkDeployment(env, job) {
  const target = buildDeployCheckUrl(env, job)
  if (!target) {
    return { status: 'deploy_failed', note: '검사할 URL을 계산하지 못했습니다. 게시 경로를 확인해 주세요.' }
  }

  const timeoutMs = Number(env?.DEPLOY_CHECK_TIMEOUT_MS) > 0 ? Number(env.DEPLOY_CHECK_TIMEOUT_MS) : DEPLOY_CHECK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(target.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html', 'user-agent': 'aiseolab-deploy-check/1.0' },
    })
  } catch (e) {
    clearTimeout(timer)
    return {
      status: 'deploy_failed',
      note: e?.name === 'AbortError' ? '확인 요청이 10초 안에 응답하지 않았습니다.' : '사이트에 연결하지 못했습니다.',
    }
  }
  clearTimeout(timer)

  // redirect가 있었다면 최종 URL이 허용 origin 안인지 확인
  try {
    if (response.url && new URL(response.url).origin !== new URL(target.origin).origin) {
      return { status: 'deploy_failed', note: '허용되지 않은 위치로 이동되었습니다.' }
    }
  } catch {
    return { status: 'deploy_failed', note: '최종 URL을 확인하지 못했습니다.' }
  }

  // 삭제된 글: 404가 곧 "삭제 반영 완료"
  if (job.publishStatus === 'deleted') {
    if (response.status === 404) return { status: 'deployed', note: '삭제가 사이트에 반영되었습니다 (404 확인).' }
    if (response.status === 200) return { status: 'pending', note: '아직 삭제 전 페이지가 남아 있습니다. 재배포 완료 후 다시 확인해 주세요.' }
    return { status: 'deploy_failed', note: `예상하지 못한 응답입니다 (HTTP ${response.status}).` }
  }

  if (response.status === 404) {
    return { status: 'pending', note: '아직 배포 반영 전입니다 (404). 1~2분 후 다시 확인해 주세요.' }
  }
  if (response.status !== 200) {
    return { status: 'deploy_failed', note: `사이트가 오류를 반환했습니다 (HTTP ${response.status}).` }
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    return { status: 'deploy_failed', note: '응답이 HTML 페이지가 아닙니다.' }
  }
  // 가벼운 내용 확인: 페이지에 slug(canonical 링크에 항상 포함)가 있는지만 확인
  // (본문은 저장하지 않음 — 확인 후 즉시 폐기)
  const bodyText = await response.text().catch(() => '')
  if (!bodyText.includes(target.slug)) {
    return { status: 'deploy_failed', note: '페이지가 열리지만 게시한 글이 아닌 것으로 보입니다.' }
  }
  return { status: 'deployed', note: '사이트 게시가 확인되었습니다 (HTTP 200).' }
}
