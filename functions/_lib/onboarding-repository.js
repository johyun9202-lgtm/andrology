// ============================================================
// OnboardingRepository — site_onboarding 테이블 접근 계층 (Cloudflare D1)
//
// Functions에서 SQL을 직접 쓰지 않고 이 저장소만 사용합니다.
// 모든 쿼리는 prepared statement + 바인딩 파라미터를 사용합니다.
// (migrations/0005_create_site_onboarding.sql)
// ============================================================

import { computeProgress } from './onboarding.js'

const ONBOARDING_FIELDS =
  'site_id, hospital_name, manager_name, manager_phone, manager_email, ' +
  'operation_mode, existing_url, reservation_url, phone, naver_map_url, kakao_channel_url, ' +
  'new_domain, domain_status, checklist, stage, created_at, updated_at'

// DB 행 → API 응답 객체 (스네이크 → 카멜, checklist JSON 파싱, 진행률 계산 포함)
function toOnboarding(row) {
  if (!row) return null
  let checklist = {}
  try {
    const parsed = JSON.parse(row.checklist ?? '{}')
    if (parsed && typeof parsed === 'object') checklist = parsed
  } catch {
    checklist = {}
  }
  return {
    siteId: row.site_id,
    hospitalName: row.hospital_name,
    managerName: row.manager_name ?? '',
    managerPhone: row.manager_phone ?? '',
    managerEmail: row.manager_email ?? '',
    operationMode: row.operation_mode ?? 'independent',
    existingUrl: row.existing_url ?? '',
    reservationUrl: row.reservation_url ?? '',
    phone: row.phone ?? '',
    naverMapUrl: row.naver_map_url ?? '',
    kakaoChannelUrl: row.kakao_channel_url ?? '',
    newDomain: row.new_domain ?? '',
    domainStatus: row.domain_status ?? 'undecided',
    checklist,
    stage: row.stage ?? 'onboarding',
    progress: computeProgress(checklist),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 신규 온보딩 레코드 생성 (value = validateOnboardingInput 통과 객체)
export async function insertOnboarding(db, siteId, value) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO site_onboarding (${ONBOARDING_FIELDS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      siteId,
      value.hospitalName,
      value.managerName,
      value.managerPhone,
      value.managerEmail,
      value.operationMode,
      value.existingUrl,
      value.reservationUrl,
      value.phone,
      value.naverMapUrl,
      value.kakaoChannelUrl,
      value.newDomain,
      value.domainStatus,
      JSON.stringify(value.checklist),
      'onboarding',
      now,
      now
    )
    .run()
  return getOnboarding(db, siteId)
}

export async function getOnboarding(db, siteId) {
  const row = await db
    .prepare(`SELECT ${ONBOARDING_FIELDS} FROM site_onboarding WHERE site_id = ?`)
    .bind(siteId)
    .first()
  return toOnboarding(row)
}

// 전체 목록 (대시보드 진행률 표시용) — 최근 생성 순
export async function listOnboarding(db) {
  const { results } = await db
    .prepare(`SELECT ${ONBOARDING_FIELDS} FROM site_onboarding ORDER BY created_at DESC, site_id ASC`)
    .bind()
    .all()
  return (results ?? []).map(toOnboarding)
}

// (Phase 14C) Domain Wizard → 온보딩 도메인 필드 동기화 (하위 호환 유지용 targeted update)
export async function updateOnboardingDomain(db, siteId, { newDomain, domainStatus }) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(`UPDATE site_onboarding SET new_domain = ?, domain_status = ?, updated_at = ? WHERE site_id = ?`)
    .bind(String(newDomain ?? ''), domainStatus === 'decided' ? 'decided' : 'undecided', now, siteId)
    .run()
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0
}

// (Phase 14C) 작업 체크 개별 항목을 "완료로만" 올림 — 직원이 수동으로 체크한 값을
// 내리지 않습니다 (완료 → 미완료 방향 변경 없음)
export async function upgradeOnboardingChecklistItem(db, siteId, key) {
  const record = await getOnboarding(db, siteId)
  if (!record || record.checklist?.[key] === true) return false
  const checklist = { ...record.checklist, [key]: true }
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE site_onboarding SET checklist = ?, updated_at = ? WHERE site_id = ?`)
    .bind(JSON.stringify(checklist), now, siteId)
    .run()
  return true
}

// (Phase 15) stage 전이 — Deploy Engine의 전이 규칙(nextStageForDeploy)을 통해서만 호출
export async function setOnboardingStage(db, siteId, stage) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(`UPDATE site_onboarding SET stage = ?, updated_at = ? WHERE site_id = ?`)
    .bind(String(stage), now, siteId)
    .run()
  return (result?.meta?.changes ?? result?.changes ?? 0) > 0
}

// 온보딩 정보 수정 (stage는 이후 Phase의 전이 로직에서만 변경 — 여기서는 유지)
export async function updateOnboarding(db, siteId, value) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE site_onboarding SET
         hospital_name = ?, manager_name = ?, manager_phone = ?, manager_email = ?,
         operation_mode = ?, existing_url = ?, reservation_url = ?, phone = ?,
         naver_map_url = ?, kakao_channel_url = ?, new_domain = ?, domain_status = ?,
         checklist = ?, updated_at = ?
       WHERE site_id = ?`
    )
    .bind(
      value.hospitalName,
      value.managerName,
      value.managerPhone,
      value.managerEmail,
      value.operationMode,
      value.existingUrl,
      value.reservationUrl,
      value.phone,
      value.naverMapUrl,
      value.kakaoChannelUrl,
      value.newDomain,
      value.domainStatus,
      JSON.stringify(value.checklist),
      now,
      siteId
    )
    .run()
  if ((result?.meta?.changes ?? result?.changes ?? 0) === 0) return null
  return getOnboarding(db, siteId)
}
