// ============================================================
// Deploy 사전 검사(Preflight) + 배포 계획 요약 (Phase 15)
//
// - 판정 규칙(buildPreflightChecks/summarizePreflight)은 순수 함수로 분리
//   (단위 테스트 대상). 데이터 수집(runPreflight)만 env·DB를 사용합니다.
// - 도메인 준비 판정은 Phase 14C와 동일한 모듈(computeDeployReady)을 재사용 —
//   별도 규칙을 중복 구현하지 않습니다.
// - 상태: pass | warning | fail | skipped
//   규칙: warning은 배포 가능(목록으로 안내), fail이 하나라도 있으면
//   Production/Replace 배포 불가. Preview는 사이트 데이터 fail만 차단.
// ============================================================

import { SITE_DATA, TEMPLATES } from './site-data.generated.js'
import { resolveGitHubConfig, githubFetch } from './publisher.js'
import { readHospitalFile } from '../api/site-settings.js'
import { validateEntities } from './entities.js'
import { computeDeployReady } from './domain-status.js'
import { getActiveConnection } from './domain-repository.js'
import { getOnboarding } from './onboarding-repository.js'
import { latestImportForSite } from './import-repository.js'

const isReal = (value) => typeof value === 'string' && value.trim() !== '' && value.trim() !== '미정'

// ---------- 순수: 검사 규칙 ----------
export function buildPreflightChecks(input) {
  const {
    type, hospital, hospitalError, siteInBundle, entityErrors, templateKnown,
    articlesCount, onboarding, connection, readiness,
  } = input
  const checks = []
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail })

  // 사이트 검사
  if (hospitalError) {
    add('hospital-json', 'hospital.json 읽기·파싱', 'fail', hospitalError)
  } else {
    add('hospital-json', 'hospital.json 읽기·파싱', 'pass', '정상')
    add('required-name', '병원명', isReal(hospital?.name) ? 'pass' : 'fail', isReal(hospital?.name) ? hospital.name : '병원명이 비어 있습니다. 사이트 설정에서 입력해 주세요.')
    add('required-description', '병원 소개', (hospital?.description ?? '').trim().length >= 20 ? 'pass' : 'warning',
      (hospital?.description ?? '').trim().length >= 20 ? '정상' : '소개 문구가 짧거나 없습니다. (검색 노출 품질에 영향)')
    const contact = [isReal(hospital?.phone), isReal(hospital?.address)].filter(Boolean).length
    add('required-contact', '전화·주소', contact === 2 ? 'pass' : 'warning', contact === 2 ? '정상' : '전화 또는 주소가 "미정"입니다. 배포 전 입력을 권장합니다.')
    add('entities', 'Entity(진료과·의료진) 유효성', entityErrors.length === 0 ? 'pass' : 'fail',
      entityErrors.length === 0 ? '정상' : entityErrors.slice(0, 2).join(' '))
    add('template', '템플릿', templateKnown ? 'pass' : 'fail', templateKnown ? (hospital?.template ?? 'medical') : `등록되지 않은 템플릿: ${hospital?.template}`)
    const channels = hospital?.channels ?? {}
    const hasCta = isReal(hospital?.phone) || [channels.naverBooking, channels.kakao, channels.consult, channels.naverMap].some((v) => isReal(v))
    add('cta', '전환(CTA) 정보 — 전화·예약·지도', hasCta ? 'pass' : 'warning', hasCta ? '정상' : '전환 채널이 없습니다. 온보딩 전환정보 또는 사이트 설정에서 입력해 주세요.')
    add('seo-data', 'SEO 데이터(제목·설명)', isReal(hospital?.description) || hospital?.seo ? 'pass' : 'warning',
      '페이지 title·description·canonical·sitemap은 빌드 시 자동 생성됩니다.')
    const leaked = ['managerName', 'managerPhone', 'managerEmail'].filter((key) => hospital && Object.hasOwn(hospital, key))
    add('internal-separation', '내부 정보 분리(담당자 연락처 미포함)', leaked.length === 0 ? 'pass' : 'fail',
      leaked.length === 0 ? '정상 — 온보딩 담당자 정보는 공개 파일에 없습니다.' : `공개 파일에 내부 필드가 있습니다: ${leaked.join(', ')}`)
  }
  add('site-bundle', '현재 배포 번들 포함 여부', siteInBundle ? 'pass' : 'warning',
    siteInBundle ? '정상' : '현재 배포 번들에 없는 신규 사이트입니다. 이번 빌드부터 포함됩니다.')
  add('articles', '콘텐츠(아티클)', articlesCount > 0 ? 'pass' : 'warning', articlesCount > 0 ? `${articlesCount}개` : '게시된 콘텐츠가 없습니다.')
  add('build', '정적 빌드·check:seo', 'skipped', '빌드와 SEO 검사는 Cloudflare Pages 빌드 파이프라인(npm run build)에서 실행되며, 실패 시 배포되지 않습니다. 결과는 배포 상태로 추적합니다.')

  // 운영 검사
  if (onboarding) {
    const percent = onboarding.progress?.percent ?? 0
    add('onboarding', `온보딩 진행률 ${percent}%`, percent >= 50 ? 'pass' : 'warning', percent >= 50 ? '정상' : '온보딩 작업 체크가 절반 미만입니다.')
  } else {
    add('onboarding', '온보딩 진행률', 'skipped', '온보딩 레코드가 없습니다.')
  }

  // 도메인 검사 (Preview는 도메인 없이 가능)
  if (type === 'preview') {
    add('domain-readiness', '도메인 배포 준비', 'skipped', 'Preview는 운영 도메인에 반영되지 않아 검사하지 않습니다.')
    add('replace-approval', '교체(replace) 승인', 'skipped', 'Preview에는 적용되지 않습니다.')
  } else {
    if (readiness?.ready) {
      add('domain-readiness', '도메인 배포 준비(deploy_ready)', 'pass',
        `대상: ${connection?.domain} · DNS ${connection?.dnsStatus} · HTTPS ${connection?.httpsStatus} · 마지막 검증 ${connection?.lastCheckedAt ?? '-'}`)
    } else {
      add('domain-readiness', '도메인 배포 준비(deploy_ready)', 'fail',
        (readiness?.reasons ?? ['도메인이 등록되지 않았습니다.']).join(' ') + ' → 온보딩 탭 [도메인]에서 완료해 주세요.')
    }
    if (input.type === 'replace' || connection?.operationMode === 'replace') {
      add('replace-approval', '교체(replace) 전환 승인', connection?.replacementApproved ? 'pass' : 'fail',
        connection?.replacementApproved ? '전환 승인 확인됨' : '도메인 탭에서 전환 승인 체크가 필요합니다.')
    } else {
      add('replace-approval', '교체(replace) 승인', 'skipped', '교체 모드가 아닙니다.')
    }
  }
  return checks
}

// 순수: 요약·배포 가능 판정 (fail 1개라도 있으면 불가 — warning은 가능하되 목록 안내)
export function summarizePreflight(checks) {
  const counts = { pass: 0, warning: 0, fail: 0, skipped: 0 }
  for (const check of checks) counts[check.status] = (counts[check.status] ?? 0) + 1
  return { ...counts, canDeploy: counts.fail === 0 }
}

// ---------- 데이터 수집 ----------

export async function getBranchHeadSha(env, branch) {
  const config = resolveGitHubConfig(env)
  if (!config.ok) return ''
  try {
    const response = await githubFetch(config, `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(branch)}`)
    if (!response.ok) return ''
    const data = await response.json().catch(() => null)
    return String(data?.object?.sha ?? data?.sha ?? '')
  } catch {
    return ''
  }
}

// 배포 전 사전 검사 + 계획 데이터 수집.
// 반환: { checks, summary, plan, hospital, connection, readiness }
export async function runPreflight(env, db, siteId, type) {
  const bundle = SITE_DATA[siteId] ?? null

  // 1) 현재 hospital.json (GitHub = 다음 빌드에 반영될 원본)
  let hospital = null
  let hospitalError = ''
  const config = resolveGitHubConfig(env)
  if (!config.ok) {
    hospitalError = config.error
  } else {
    try {
      const read = await readHospitalFile(config, siteId)
      hospital = read.hospital
    } catch (e) {
      hospitalError = `hospital.json을 읽지 못했습니다: ${e?.message ?? e}`
    }
  }

  // 2) Entity·템플릿 검증
  let entityErrors = []
  if (hospital && (Array.isArray(hospital.departments) || Array.isArray(hospital.doctors))) {
    const validated = validateEntities({
      departments: Array.isArray(hospital.departments) ? hospital.departments : [],
      doctors: Array.isArray(hospital.doctors) ? hospital.doctors : [],
    })
    if (validated.errors) entityErrors = validated.errors
  }
  const templateKnown = !hospital?.template || Object.hasOwn(TEMPLATES, hospital.template)

  // 3) 도메인·온보딩·Import
  const connection = await getActiveConnection(db, siteId).catch(() => null)
  const readiness = connection
    ? computeDeployReady({
        domain: connection.domain, dnsStatus: connection.dnsStatus, httpsStatus: connection.httpsStatus,
        operationMode: connection.operationMode, replacementApproved: connection.replacementApproved,
      })
    : { ready: false, reasons: ['등록된 도메인이 없습니다.'] }
  const onboarding = await getOnboarding(db, siteId).catch(() => null)
  const latestImport = await latestImportForSite(db, siteId).catch(() => null)

  const articlesCount = Array.isArray(bundle?.articles) ? bundle.articles.length : 0
  const checks = buildPreflightChecks({
    type, hospital, hospitalError, siteInBundle: !!bundle, entityErrors, templateKnown,
    articlesCount, onboarding, connection, readiness,
  })
  const summary = summarizePreflight(checks)

  // 4) 변경 요약 (현재 배포 번들 vs GitHub 원본 — 정확한 Git diff 대신 데이터 수준 비교)
  const compareKeys = ['name', 'description', 'phone', 'address', 'hours', 'channels', 'services', 'faq', 'seo', 'hero', 'cta']
  const changedKeys = hospital && bundle
    ? compareKeys.filter((key) => JSON.stringify(hospital[key] ?? null) !== JSON.stringify(bundle[key] ?? null))
    : []
  const plan = {
    hospitalName: hospital?.name ?? bundle?.name ?? siteId,
    siteId,
    deploymentType: type,
    operationMode: connection?.operationMode ?? onboarding?.operationMode ?? 'independent',
    targetDomain: connection?.domain ?? '',
    currentUrl: typeof bundle?.site?.url === 'string' ? bundle.site.url : '',
    changes: {
      hospitalJsonChanged: changedKeys.length > 0,
      changedFields: changedKeys,
      doctorsDelta: (Array.isArray(hospital?.doctors) ? hospital.doctors.length : 0) - (Array.isArray(bundle?.doctors) ? bundle.doctors.length : 0),
      departmentsDelta: (Array.isArray(hospital?.departments) ? hospital.departments.length : 0) - (Array.isArray(bundle?.departments) ? bundle.departments.length : 0),
      templateChanged: (hospital?.template ?? 'medical') !== (bundle?.template ?? 'medical'),
      imagesChanged: JSON.stringify(hospital?.images ?? null) !== JSON.stringify(bundle?.images ?? null),
      schemaChanged: JSON.stringify(hospital?.schema ?? null) !== JSON.stringify(bundle?.schema ?? null),
      articlesInBundle: articlesCount,
    },
    recentImport: latestImport
      ? { appliedAt: latestImport.appliedAt, appliedFields: latestImport.appliedFields, score: latestImport.score, completedAt: latestImport.completedAt }
      : null,
    domain: connection
      ? { domain: connection.domain, verificationStatus: connection.verificationStatus, lastCheckedAt: connection.lastCheckedAt }
      : null,
    postDeployTasks:
      type === 'preview'
        ? ['Preview URL 내부 검수', '병원 전달 전 오탈자·정보 확인']
        : type === 'replace'
          ? ['배포 후 검증 실행', '기존 도메인 전환(DNS) 직접 실행', '전환 후 재검증', '문제 시 기록해 둔 기존 레코드로 롤백']
          : ['배포 후 검증 실행', '네이버 Search Advisor sitemap 제출(수동)', '온보딩 잔여 작업 확인'],
  }

  return { checks, summary, plan, hospital, connection, readiness }
}
