// ============================================================
// Deploy 상태·전이·오류 코드 — 순수 함수 (Phase 15)
//
// 상태값·전이 규칙·오류 코드는 이 파일 한 곳에서만 관리합니다.
// ============================================================

export const DEPLOYMENT_TYPES = ['preview', 'production', 'replace']

export const DEPLOY_STATUSES = [
  'queued', 'validating', 'building', 'deploying', 'verifying',
  'success', 'partial_success', 'failed', 'cancelled', 'rolled_back',
]

export const DEPLOY_STATUS_LABELS = {
  queued: '대기',
  validating: '사전 검사 중',
  building: '빌드 중',
  deploying: '배포 중',
  verifying: '검증 대기',
  success: '성공',
  partial_success: '부분 성공',
  failed: '실패',
  cancelled: '취소됨',
  rolled_back: '롤백됨',
}

// 진행 중(중복 배포 차단 대상) 상태
export const ACTIVE_STATUSES = ['queued', 'validating', 'building', 'deploying', 'verifying']
// 진행 중 작업이 이 시간(ms)을 넘기면 지연으로 보고 새 배포를 허용 (Pages 빌드 지연 대비)
export const STALE_DEPLOY_MS = 30 * 60 * 1000

// 허용 상태 전이
const TRANSITIONS = {
  queued: ['validating', 'building', 'failed', 'cancelled'],
  validating: ['building', 'failed', 'cancelled'],
  building: ['deploying', 'verifying', 'success', 'partial_success', 'failed', 'cancelled'],
  deploying: ['verifying', 'success', 'partial_success', 'failed', 'cancelled'],
  verifying: ['success', 'partial_success', 'failed'],
  success: ['rolled_back'],
  partial_success: ['verifying', 'rolled_back'],
  failed: ['verifying', 'rolled_back'],
  cancelled: [],
  rolled_back: [],
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to)
}

// 표준 오류 코드 → 직원 안내 (기술 원문 + 다음 행동)
export const DEPLOY_ERROR_GUIDES = {
  domain_not_ready: '도메인 준비가 완료되지 않았습니다. → 온보딩 탭 [도메인]에서 검증을 완료해 주세요.',
  preflight_failed: '사전 검사에 실패(fail) 항목이 있습니다. → 검사 결과의 fail 항목을 해결한 뒤 다시 시도해 주세요.',
  replace_not_approved: '기존 홈페이지 교체 승인 조건이 충족되지 않았습니다. → 도메인 탭의 전환 승인과 배포 승인 체크를 완료해 주세요.',
  duplicate_deploy: '이 사이트의 배포가 이미 진행 중입니다. → 진행 중인 배포가 끝난 뒤 다시 시도하거나 상태를 새로고침해 주세요.',
  no_cf_token: 'Cloudflare API Token이 없어 자동 배포를 실행할 수 없습니다. → 수동 배포(git push 또는 Dashboard 재배포) 후 [배포 후 검증]을 실행해 주세요.',
  cf_permission: 'Cloudflare API 권한이 부족합니다. → Token 권한(Pages:Edit)을 확인하거나 수동 배포로 진행해 주세요.',
  pages_project_missing: 'Pages 프로젝트를 찾을 수 없습니다. → 배포 설정의 프로젝트명 또는 CLOUDFLARE_PAGES_PROJECT를 확인해 주세요.',
  pages_build_failed: 'Pages 빌드가 실패했습니다. → Cloudflare Dashboard의 빌드 로그를 확인하고 수정 후 다시 배포해 주세요.',
  deploy_timeout: '배포 상태 확인이 시간 내에 완료되지 않았습니다. → 잠시 후 [상태 새로고침]을 눌러 주세요.',
  github_auth: 'GitHub 인증에 실패했습니다. → GITHUB_TOKEN 권한과 만료 여부를 확인해 주세요.',
  verify_failed: '배포 후 검증에 실패했습니다. → 검증 상세의 실패 항목을 확인하고, 심각한 경우 이전 버전 복구를 검토해 주세요.',
  wrong_site: '대상 도메인에 다른 사이트가 표시됩니다. → Pages 프로젝트-도메인 연결과 SITE 환경변수를 즉시 확인해 주세요.',
  rollback_unavailable: '되돌릴 이전 성공 배포 기록이 없습니다. → 수동 복구 절차(문서의 rollback 안내)를 따라 주세요.',
}

// ---------- Stage 전이 (Phase 14A stage 컬럼과 연동) ----------
// onboarding → import → domain → deploy → operating (+ error, paused)
// 규칙:
//  - production/replace 배포 시작 → stage 'deploy' (operating이었다면 유지)
//  - production/replace 검증 success → 'operating'
//  - 실패: 이전 성공 배포가 있으면 stage 유지, 첫 배포 실패면 'error'
//  - preview는 stage를 바꾸지 않음
export function nextStageForDeploy({ event, deploymentType, currentStage, hadSuccessBefore }) {
  if (deploymentType === 'preview') return null // 변경 없음
  if (event === 'started') {
    return currentStage === 'operating' ? null : 'deploy'
  }
  if (event === 'verified_success') return 'operating'
  if (event === 'failed') {
    if (hadSuccessBefore) return null // 기존 정상 운영 유지
    return 'error'
  }
  return null
}
