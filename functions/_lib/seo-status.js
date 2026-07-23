// ============================================================
// SEO Operations — 상태·운영 대상 판정·우선순위·fingerprint (Phase 16, 순수 함수)
//
// 상태값·판정 규칙은 이 파일 한 곳에서만 관리합니다.
// ============================================================

export const RUN_STATUSES = ['queued', 'running', 'completed', 'partial_success', 'failed']
export const FINDING_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'ignored', 'reopened']
export const TASK_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'ignored', 'reopened']
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const CATEGORIES = ['technical', 'content', 'entity', 'conversion', 'operations']

export const SEVERITY_LABELS = { critical: '긴급', high: '높음', medium: '보통', low: '낮음', info: '참고' }
export const CATEGORY_LABELS = { technical: 'Technical', content: 'Content', entity: 'Entity', conversion: 'Conversion', operations: 'Operations' }
export const SITE_STATUS_LABELS = {
  healthy: '정상', good: '양호', warning: '주의', critical: '심각',
  checking: '점검 중', paused: '일시 중지', error: '오류', deploy: '배포 단계',
  domain_pending: '도메인 미검증', not_operating: '운영 전', check_failed: '점검 실패', unchecked: '미점검',
}

// ---------- 운영 대상 판정 ----------
// 입력: { onboarding, connection(활성 도메인), lastProductionSuccess(존재 여부), settings }
// 반환: { operability, checkable, reason }
//  - operability: operating | deploy | error | paused | domain_pending | not_operating
//  - checkable: SEO 점검 실행 가능 여부 (paused·운영 전 사이트는 제외)
export function classifySiteOperability({ onboarding, connection, hasProductionSuccess, settings }) {
  const stage = onboarding?.stage ?? 'onboarding'
  if (settings && settings.checkEnabled === false) {
    return { operability: 'paused', checkable: false, reason: settings.pausedReason || '점검이 일시 중지되었습니다.' }
  }
  if (stage === 'paused') return { operability: 'paused', checkable: false, reason: '일시 중지된 사이트입니다.' }
  if (stage === 'error') return { operability: 'error', checkable: true, reason: '배포 오류 상태 — 원인 확인이 필요합니다.' }
  if (stage !== 'operating') {
    return { operability: stage === 'deploy' ? 'deploy' : 'not_operating', checkable: false, reason: '아직 운영(operating) 단계가 아닙니다.' }
  }
  if (!connection || !connection.domain) {
    return { operability: 'domain_pending', checkable: false, reason: '활성 도메인이 없습니다. 도메인 탭에서 등록해 주세요.' }
  }
  if (!hasProductionSuccess) {
    return { operability: 'deploy', checkable: false, reason: '성공한 Production/Replace 배포가 아직 없습니다.' }
  }
  return { operability: 'operating', checkable: true, reason: '' }
}

// 점수 → 사이트 표시 상태 (점검 결과가 있을 때)
export function siteStatusFromScore(score, { checkFailed = false } = {}) {
  if (checkFailed) return 'check_failed'
  if (score >= 90) return 'healthy'
  if (score >= 75) return 'good'
  if (score >= 60) return 'warning'
  return 'critical'
}

// ---------- finding fingerprint (중복 생성 방지의 단일 기준) ----------
export function findingFingerprint(siteId, ruleKey, affectedUrl = '') {
  let path = ''
  try {
    path = affectedUrl ? new URL(affectedUrl).pathname : ''
  } catch {
    path = String(affectedUrl).slice(0, 80)
  }
  return `${siteId}:${ruleKey}:${path}`
}

// ---------- 우선순위 점수 ----------
// severity 기본 + 사이트 전체 영향 + 전환 영향 + 방치 기간 + 최근 배포 직후 발생
const SEVERITY_BASE = { critical: 100, high: 70, medium: 40, low: 20, info: 5 }

export function computePriorityScore({ severity, category, sitewide = false, firstDetectedAt, autoFixable = false, afterRecentDeploy = false, now }) {
  let score = SEVERITY_BASE[severity] ?? 10
  if (sitewide) score += 15
  if (category === 'conversion') score += 10
  if (afterRecentDeploy) score += 10
  if (autoFixable) score -= 5
  if (firstDetectedAt && now) {
    const days = Math.floor((now - Date.parse(firstDetectedAt)) / 86_400_000)
    score += Math.min(15, Math.max(0, days)) // 방치 1일당 +1, 최대 +15
  }
  return Math.max(1, score)
}

// ---------- 작업 상태 전이 ----------
const TASK_TRANSITIONS = {
  open: ['acknowledged', 'in_progress', 'resolved', 'ignored'],
  acknowledged: ['in_progress', 'resolved', 'ignored', 'open'],
  in_progress: ['resolved', 'ignored', 'open'],
  resolved: ['reopened'],
  ignored: ['reopened'],
  reopened: ['acknowledged', 'in_progress', 'resolved', 'ignored'],
}

export function canTaskTransition(from, to) {
  return (TASK_TRANSITIONS[from] ?? []).includes(to)
}

// critical 작업 무시는 사유 필수 (강한 확인)
export function validateTaskAction({ toStatus, severity, note }) {
  if (toStatus === 'ignored' && severity === 'critical' && String(note ?? '').trim() === '') {
    return 'critical 작업은 사유 없이 무시할 수 없습니다. 무시 사유를 입력해 주세요.'
  }
  return null
}
