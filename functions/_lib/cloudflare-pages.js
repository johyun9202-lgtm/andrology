// ============================================================
// Cloudflare Pages Custom Domain — API Mode (Phase 14C)
//
// - API Token이 없으면 Manual Mode: 모든 함수가 안전한 'manual' 결과를 반환
//   (자동 기능은 UI에서 숨김/비활성)
// - 토큰은 요청 헤더에만 사용 — 응답·로그·오류 메시지에 절대 포함하지 않음
// - 이번 Phase 범위: Custom Domain 조회·추가만 (삭제·DNS 변경 없음)
// - 테스트 전용 재정의: CF_API_URL (실서버 미설정 시 공식 API)
// ============================================================

const DEFAULT_API_URL = 'https://api.cloudflare.com/client/v4'

export function hasCloudflareApi(env) {
  return (
    typeof env?.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.trim() !== '' &&
    typeof env?.CLOUDFLARE_ACCOUNT_ID === 'string' && env.CLOUDFLARE_ACCOUNT_ID.trim() !== '' &&
    typeof env?.CLOUDFLARE_PAGES_PROJECT === 'string' && env.CLOUDFLARE_PAGES_PROJECT.trim() !== ''
  )
}

async function cfFetch(env, path, options = {}) {
  const base = typeof env?.CF_API_URL === 'string' && env.CF_API_URL.trim() !== '' ? env.CF_API_URL.trim() : DEFAULT_API_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(env?.CF_API_TIMEOUT_MS) > 0 ? Number(env.CF_API_TIMEOUT_MS) : 8000)
  try {
    const headers = {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN.trim()}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    }
    // FormData 전송 시 content-type은 fetch가 boundary 포함해 자동 설정
    if (options.body instanceof FormData) delete headers['content-type']
    for (const key of Object.keys(headers)) {
      if (headers[key] === undefined) delete headers[key]
    }
    return await fetch(`${base}${path}`, { ...options, signal: controller.signal, headers })
  } finally {
    clearTimeout(timer)
  }
}

function cfErrorMessage(status) {
  if (status === 401 || status === 403) {
    return 'Cloudflare API 권한이 부족합니다. Token 권한(Pages:Edit)을 확인하거나 Manual Mode(직접 연결)로 진행하세요.'
  }
  if (status === 404) return 'Pages 프로젝트를 찾을 수 없습니다. CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_PAGES_PROJECT 설정을 확인하세요.'
  return `Cloudflare API 오류(HTTP ${status})입니다. 잠시 후 다시 시도하거나 Manual Mode로 진행하세요.`
}

// Custom Domain 목록 조회. 반환: { ok, domains: [{name, status}], error? }
export async function listPagesCustomDomains(env) {
  if (!hasCloudflareApi(env)) {
    return { ok: false, domains: [], error: 'Cloudflare API Token이 설정되지 않았습니다. Manual Mode로 진행하세요.' }
  }
  try {
    const account = env.CLOUDFLARE_ACCOUNT_ID.trim()
    const project = env.CLOUDFLARE_PAGES_PROJECT.trim()
    const response = await cfFetch(env, `/accounts/${account}/pages/projects/${project}/domains`)
    if (!response.ok) return { ok: false, domains: [], error: cfErrorMessage(response.status) }
    const data = await response.json().catch(() => null)
    const domains = (Array.isArray(data?.result) ? data.result : []).map((item) => ({
      name: String(item.name ?? '').toLowerCase(),
      status: String(item.status ?? '').toLowerCase(),
    }))
    return { ok: true, domains }
  } catch {
    return { ok: false, domains: [], error: 'Cloudflare API에 연결하지 못했습니다. Manual Mode로 진행하세요.' }
  }
}

// Custom Domain 추가 (명시적 실행 시에만 호출 — 삭제·DNS 변경 없음)
export async function addPagesCustomDomain(env, domain) {
  if (!hasCloudflareApi(env)) {
    return { ok: false, error: 'Cloudflare API Token이 설정되지 않았습니다. Cloudflare Dashboard에서 직접 추가해 주세요.' }
  }
  try {
    const account = env.CLOUDFLARE_ACCOUNT_ID.trim()
    const project = env.CLOUDFLARE_PAGES_PROJECT.trim()
    const response = await cfFetch(env, `/accounts/${account}/pages/projects/${project}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    })
    if (response.status === 409) return { ok: true, already: true } // 이미 추가됨
    if (!response.ok) return { ok: false, error: cfErrorMessage(response.status) }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Cloudflare API에 연결하지 못했습니다. Cloudflare Dashboard에서 직접 추가해 주세요.' }
  }
}

// ---------- (Phase 15) Pages 배포 트리거·조회·롤백 ----------
// project 인자를 주면 사이트별 프로젝트, 없으면 env.CLOUDFLARE_PAGES_PROJECT.
// 전부 명시적 실행 시에만 호출 — 강제 push·branch history 변경 없음.

function projectPath(env, project) {
  const account = env.CLOUDFLARE_ACCOUNT_ID.trim()
  const name = (project && String(project).trim() !== '' ? String(project).trim() : env.CLOUDFLARE_PAGES_PROJECT?.trim()) ?? ''
  return name === '' ? null : `/accounts/${account}/pages/projects/${name}`
}

function normalizeDeployment(item) {
  if (!item || typeof item !== 'object') return null
  return {
    id: String(item.id ?? ''),
    environment: String(item.environment ?? ''),
    url: String(item.url ?? ''),
    commitSha: String(item.deployment_trigger?.metadata?.commit_hash ?? ''),
    branch: String(item.deployment_trigger?.metadata?.branch ?? ''),
    stageName: String(item.latest_stage?.name ?? ''),
    stageStatus: String(item.latest_stage?.status ?? ''),
    createdOn: String(item.created_on ?? ''),
  }
}

// 새 배포 트리거 (지정 브랜치의 최신 커밋으로 재빌드)
export async function createPagesDeployment(env, { project, branch }) {
  if (!hasCloudflareApi(env)) return { ok: false, code: 'no_cf_token', error: 'Cloudflare API Token이 설정되지 않았습니다.' }
  const path = projectPath(env, project)
  if (!path) return { ok: false, code: 'pages_project_missing', error: 'Pages 프로젝트명이 없습니다.' }
  try {
    const form = new FormData()
    if (branch) form.append('branch', String(branch))
    const response = await cfFetch(env, `${path}/deployments`, { method: 'POST', body: form })
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'cf_permission' : response.status === 404 ? 'pages_project_missing' : 'cf_error'
      return { ok: false, code, error: cfErrorMessage(response.status) }
    }
    const data = await response.json().catch(() => null)
    return { ok: true, deployment: normalizeDeployment(data?.result) }
  } catch {
    return { ok: false, code: 'cf_error', error: 'Cloudflare API에 연결하지 못했습니다.' }
  }
}

// 배포 상태 조회
export async function getPagesDeployment(env, { project, deploymentId }) {
  if (!hasCloudflareApi(env)) return { ok: false, code: 'no_cf_token', error: 'Cloudflare API Token이 설정되지 않았습니다.' }
  const path = projectPath(env, project)
  if (!path) return { ok: false, code: 'pages_project_missing', error: 'Pages 프로젝트명이 없습니다.' }
  try {
    const response = await cfFetch(env, `${path}/deployments/${encodeURIComponent(deploymentId)}`)
    if (!response.ok) return { ok: false, code: 'cf_error', error: cfErrorMessage(response.status) }
    const data = await response.json().catch(() => null)
    return { ok: true, deployment: normalizeDeployment(data?.result) }
  } catch {
    return { ok: false, code: 'cf_error', error: 'Cloudflare API에 연결하지 못했습니다.' }
  }
}

// 최근 배포 목록 (production 환경 우선 확인용)
export async function listPagesDeployments(env, { project } = {}) {
  if (!hasCloudflareApi(env)) return { ok: false, code: 'no_cf_token', deployments: [], error: 'Cloudflare API Token이 설정되지 않았습니다.' }
  const path = projectPath(env, project)
  if (!path) return { ok: false, code: 'pages_project_missing', deployments: [], error: 'Pages 프로젝트명이 없습니다.' }
  try {
    const response = await cfFetch(env, `${path}/deployments?per_page=10`)
    if (!response.ok) return { ok: false, code: 'cf_error', deployments: [], error: cfErrorMessage(response.status) }
    const data = await response.json().catch(() => null)
    return { ok: true, deployments: (Array.isArray(data?.result) ? data.result : []).map(normalizeDeployment).filter(Boolean) }
  } catch {
    return { ok: false, code: 'cf_error', deployments: [], error: 'Cloudflare API에 연결하지 못했습니다.' }
  }
}

// 이전 성공 배포로 롤백 (명시적 실행 + 사유 입력 후에만 호출)
export async function rollbackPagesDeployment(env, { project, deploymentId }) {
  if (!hasCloudflareApi(env)) return { ok: false, code: 'no_cf_token', error: 'Cloudflare API Token이 설정되지 않았습니다. 수동 복구 절차를 따라 주세요.' }
  const path = projectPath(env, project)
  if (!path) return { ok: false, code: 'pages_project_missing', error: 'Pages 프로젝트명이 없습니다.' }
  try {
    const response = await cfFetch(env, `${path}/deployments/${encodeURIComponent(deploymentId)}/rollback`, { method: 'POST' })
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'cf_permission' : 'cf_error'
      return { ok: false, code, error: cfErrorMessage(response.status) }
    }
    const data = await response.json().catch(() => null)
    return { ok: true, deployment: normalizeDeployment(data?.result) }
  } catch {
    return { ok: false, code: 'cf_error', error: 'Cloudflare API에 연결하지 못했습니다.' }
  }
}

// 특정 도메인의 Pages 연결 상태. Manual Mode면 'manual'.
// 반환: { status: 'manual'|'connected'|'pending'|'error', detail }
export async function pagesStatusFor(env, domain) {
  if (!hasCloudflareApi(env)) {
    return { status: 'manual', detail: 'API Token 미설정 — Cloudflare Dashboard → Pages → Custom domains에서 직접 확인해 주세요.' }
  }
  const list = await listPagesCustomDomains(env)
  if (!list.ok) return { status: 'error', detail: list.error }
  const found = list.domains.find((item) => item.name === String(domain).toLowerCase())
  if (!found) return { status: 'pending', detail: 'Pages Custom Domain에 아직 등록되지 않았습니다. [Pages에 연결] 또는 Dashboard에서 추가해 주세요.' }
  if (found.status === 'active') return { status: 'connected', detail: 'Pages Custom Domain 연결됨' }
  return { status: 'pending', detail: `Pages 연결 진행 중 (${found.status || '초기화'})` }
}
