// /api/sites — 사이트 목록(GET) / 새 사이트 생성(POST) — Phase 11 Site Creation Wizard
//
// - 관리자 인증 필수
// - 이번 단계는 Repository의 sites/<siteId>/ 폴더 생성까지만 담당합니다.
//   (Cloudflare Pages 프로젝트 생성·도메인 연결은 향후 Phase)
// - 생성은 기존 GitHub Publisher 헬퍼(생성 전용 PUT)를 재사용:
//   sites/<siteId>/hospital.json + sites/<siteId>/articles/.gitkeep 커밋
// - 사이트 목록·템플릿·스캐폴드는 빌드 시 번들(site-data.generated.js) 기준이며,
//   생성된 사이트는 커밋 → 재배포 후 목록·설정·게시에서 사용 가능해집니다.

import { jsonResponse, methodNotAllowed, readJsonBody, isAuthenticated, ALLOWED_SITES } from '../_lib/auth.js'
import { SITE_DATA, TEMPLATES, SITE_SCAFFOLD } from '../_lib/site-data.generated.js'
import { resolveGitHubConfig, githubFetch, githubErrorMessage, utf8ToBase64 } from '../_lib/publisher.js'
import { safeErrorMessage } from '../_lib/ai-writer.js'

const SITE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SITE_ID_LENGTH = 30
const MAX_NAME_LENGTH = 60
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// ---------- GET: 사이트 목록 + 템플릿 목록 (마법사 UI용) ----------
export async function onRequestGet(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const sites = ALLOWED_SITES.map((id) => {
    const data = SITE_DATA[id] ?? {}
    return {
      id,
      name: data.name ?? id,
      template: data.template ?? 'medical',
      siteUrl: typeof data.site?.url === 'string' ? data.site.url : '',
    }
  })
  const templates = Object.values(TEMPLATES).map(({ id, name, icon, description }) => ({ id, name, icon, description }))
  return jsonResponse({ ok: true, sites, templates, defaultSite: 'aiseolab' })
}

// ---------- POST: 새 사이트 생성 ----------
export async function onRequestPost(context) {
  if (!(await isAuthenticated(context))) {
    return jsonResponse({ ok: false, error: '로그인이 필요합니다.' }, 401)
  }
  const body = await readJsonBody(context.request, 10_000)
  if (body === null || typeof body !== 'object') {
    return jsonResponse({ ok: false, error: '요청 형식이 올바르지 않습니다. (JSON 필요)' }, 400)
  }

  // 1) 입력 검증
  const name = String(body.name ?? '').replace(CONTROL_CHARS, '').trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ ok: false, error: `사이트 이름은 1~${MAX_NAME_LENGTH}자여야 합니다.` }, 400)
  }
  if (/[<>]/.test(name)) {
    return jsonResponse({ ok: false, error: '사이트 이름에 < > 문자는 사용할 수 없습니다.' }, 400)
  }

  const siteId = String(body.siteId ?? '').trim()
  if (!SITE_ID_PATTERN.test(siteId) || siteId.length < 2 || siteId.length > MAX_SITE_ID_LENGTH) {
    return jsonResponse(
      { ok: false, error: `siteId는 영문 소문자·숫자·하이픈 2~${MAX_SITE_ID_LENGTH}자여야 합니다. (예: bright-clinic)` },
      400
    )
  }
  if (ALLOWED_SITES.includes(siteId)) {
    return jsonResponse({ ok: false, error: `이미 존재하는 siteId입니다: "${siteId}"` }, 409)
  }

  const templateId = String(body.template ?? '').trim()
  const template = TEMPLATES[templateId]
  if (!template) {
    return jsonResponse(
      { ok: false, error: `등록되지 않은 템플릿입니다. 사용 가능: ${Object.keys(TEMPLATES).join(', ')}` },
      400
    )
  }

  const config = resolveGitHubConfig(context.env)
  if (!config.ok) return jsonResponse({ ok: false, error: config.error }, 500)

  try {
    // 2) 저장소에서 최종 중복 확인 (마지막 배포 이후 생성된 사이트까지 커버)
    const checkPath = `${config.basePath}/${siteId}/hospital.json`
    const checkResponse = await githubFetch(
      config,
      `/repos/${config.owner}/${config.repo}/contents/${checkPath}?ref=${encodeURIComponent(config.branch)}`
    )
    if (checkResponse.status === 200) {
      return jsonResponse({ ok: false, error: `이미 존재하는 siteId입니다: "${siteId}" (저장소 확인)` }, 409)
    }
    if (checkResponse.status !== 404) {
      throw new Error(githubErrorMessage(checkResponse.status, checkResponse.headers))
    }

    // 3) 템플릿 기반 hospital.json 구성 (스캐폴드 복사 + 최소 커스터마이즈)
    const hospital = buildInitialHospital(name, template)

    // 4) 생성 전용 PUT 2회 — sha 없음 = 새 파일만 가능 (동시 생성 충돌은 409/422)
    const hospitalContent = JSON.stringify(hospital, null, 2) + '\n'
    const putResponse = await githubFetch(config, `/repos/${config.owner}/${config.repo}/contents/${checkPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Create site: ${siteId} (${template.id})`,
        content: utf8ToBase64(hospitalContent),
        branch: config.branch,
      }),
    })
    if (!putResponse.ok) {
      if (putResponse.status === 409 || putResponse.status === 422) {
        return jsonResponse({ ok: false, error: `이미 존재하는 siteId입니다: "${siteId}"` }, 409)
      }
      throw new Error(githubErrorMessage(putResponse.status, putResponse.headers))
    }
    const putResult = await putResponse.json().catch(() => null)
    const commitSha = putResult?.commit?.sha ?? ''

    const keepResponse = await githubFetch(
      config,
      `/repos/${config.owner}/${config.repo}/contents/${config.basePath}/${siteId}/articles/.gitkeep`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `Create site: ${siteId} (articles folder)`,
          content: utf8ToBase64(''),
          branch: config.branch,
        }),
      }
    )
    if (!keepResponse.ok) {
      // hospital.json은 이미 생성됨 — 폴더 파일만 실패한 경우 안내 (재배포에는 지장 없음)
      console.error(`[사이트 생성] articles/.gitkeep 생성 실패 site=${siteId} status=${keepResponse.status}`)
    }

    return jsonResponse({
      ok: true,
      siteId,
      template: template.id,
      commitSha,
      note: '사이트가 저장소에 생성되었습니다. 재배포(1~2분) 후 대시보드 목록·설정에서 선택할 수 있습니다.',
    })
  } catch (e) {
    const message = safeErrorMessage(e)
    console.error(`[사이트 생성 실패] siteId=${siteId} message=${message}`)
    return jsonResponse({ ok: false, error: message }, 500)
  }
}

// 스캐폴드 복사 + 이름/템플릿 반영. 비의료 업종은 병원 전용 예시 문구를 중립 문구로 교체.
function buildInitialHospital(name, template) {
  const hospital = JSON.parse(JSON.stringify(SITE_SCAFFOLD))
  hospital.name = name
  if (template.id !== 'medical') {
    hospital.template = template.id
    hospital.schema = { type: 'LocalBusiness' }
    hospital.description = `${name} 소개 문구입니다. 사이트 설정에서 실제 소개 내용으로 수정해 주세요.`
    hospital.hero = {
      title: `${name}에 오신 것을 환영합니다`,
      subtitle: '대표 문구는 사이트 설정에서 자유롭게 수정할 수 있습니다.',
    }
    hospital.cta = { label: '문의하기', description: '문의 채널은 사이트 설정에서 등록할 수 있습니다.' }
    hospital.services = [
      { slug: 'service-1', title: '대표 서비스 1', summary: '서비스 설명 예시입니다. 사이트 설정에서 수정해 주세요.' },
      { slug: 'service-2', title: '대표 서비스 2', summary: '서비스 설명 예시입니다. 사이트 설정에서 수정해 주세요.' },
      { slug: 'service-3', title: '대표 서비스 3', summary: '서비스 설명 예시입니다. 사이트 설정에서 수정해 주세요.' },
    ]
    hospital.faq = [
      { question: '자주 묻는 질문 예시 1입니까?', answer: '답변 예시입니다. 사이트 설정 이후 수정할 수 있습니다.' },
      { question: '자주 묻는 질문 예시 2입니까?', answer: '답변 예시입니다. 사이트 설정 이후 수정할 수 있습니다.' },
      { question: '자주 묻는 질문 예시 3입니까?', answer: '답변 예시입니다. 사이트 설정 이후 수정할 수 있습니다.' },
    ]
  }
  return hospital
}

export function onRequest() {
  return methodNotAllowed()
}
