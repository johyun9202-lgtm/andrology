// ============================================================
// DomainRepository — domain_connections 테이블 접근 계층 (Cloudflare D1)
//
// prepared statement + 바인딩 파라미터만 사용합니다.
// site_id별 활성(active=1) 도메인은 1행 — 새 도메인 저장 시 이전 행은
// active=0으로 남겨 과거 상태·검증 이력을 보존합니다.
// (migrations/0007_create_domain_connections.sql)
// ============================================================

const FIELDS =
  'id, site_id, domain, domain_type, operation_mode, management_type, registrar_name, ' +
  'expiry_date, auto_renew_status, nameserver_status, notes, expected_dns_records, ' +
  'actual_dns_records, dns_status, pages_status, https_status, verification_status, ' +
  'last_checked_at, error_message, deploy_ready, replacement_approved, active, created_at, updated_at'

function parseJson(text, fallback) {
  try {
    const parsed = JSON.parse(text ?? '')
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function toConnection(row) {
  if (!row) return null
  return {
    id: row.id,
    siteId: row.site_id,
    domain: row.domain,
    domainType: row.domain_type,
    operationMode: row.operation_mode,
    managementType: row.management_type,
    registrarName: row.registrar_name ?? '',
    expiryDate: row.expiry_date ?? '',
    autoRenewStatus: row.auto_renew_status ?? 'unknown',
    nameserverStatus: row.nameserver_status ?? '',
    notes: row.notes ?? '',
    expectedDnsRecords: parseJson(row.expected_dns_records, []),
    actualDnsRecords: parseJson(row.actual_dns_records, []),
    dnsStatus: row.dns_status,
    pagesStatus: row.pages_status,
    httpsStatus: row.https_status,
    verificationStatus: row.verification_status,
    lastCheckedAt: row.last_checked_at ?? null,
    errorMessage: row.error_message ?? '',
    deployReady: row.deploy_ready === 1,
    replacementApproved: row.replacement_approved === 1,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getActiveConnection(db, siteId) {
  const row = await db
    .prepare(`SELECT ${FIELDS} FROM domain_connections WHERE site_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1`)
    .bind(siteId)
    .first()
  return toConnection(row)
}

// 같은 도메인이 다른 사이트에 활성 등록되어 있는지 (중복 등록 방지)
export async function findActiveDomainOwner(db, domain, excludeSiteId) {
  const row = await db
    .prepare(`SELECT ${FIELDS} FROM domain_connections WHERE domain = ? AND active = 1 AND site_id != ? LIMIT 1`)
    .bind(domain, excludeSiteId)
    .first()
  return toConnection(row)
}

export async function deactivateSiteConnections(db, siteId) {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE domain_connections SET active = 0, updated_at = ? WHERE site_id = ? AND active = 1`)
    .bind(now, siteId)
    .run()
}

export async function insertConnection(db, data) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO domain_connections (
         id, site_id, domain, domain_type, operation_mode, management_type, registrar_name,
         expiry_date, auto_renew_status, nameserver_status, notes, expected_dns_records,
         replacement_approved, active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(
      data.id, data.siteId, data.domain, data.domainType, data.operationMode,
      data.managementType, data.registrarName, data.expiryDate, data.autoRenewStatus,
      data.nameserverStatus, data.notes, JSON.stringify(data.expectedDnsRecords ?? []),
      data.replacementApproved ? 1 : 0, now, now
    )
    .run()
  return getActiveConnection(db, data.siteId)
}

// 허용된 컬럼만 갱신 (컬럼명은 고정 화이트리스트 — 값은 전부 바인딩)
const UPDATABLE = {
  managementType: 'management_type',
  registrarName: 'registrar_name',
  expiryDate: 'expiry_date',
  autoRenewStatus: 'auto_renew_status',
  nameserverStatus: 'nameserver_status',
  notes: 'notes',
  expectedDnsRecords: 'expected_dns_records',
  actualDnsRecords: 'actual_dns_records',
  dnsStatus: 'dns_status',
  pagesStatus: 'pages_status',
  httpsStatus: 'https_status',
  verificationStatus: 'verification_status',
  lastCheckedAt: 'last_checked_at',
  errorMessage: 'error_message',
  deployReady: 'deploy_ready',
  replacementApproved: 'replacement_approved',
  operationMode: 'operation_mode',
}

export async function updateConnection(db, id, siteId, fields) {
  const sets = []
  const values = []
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] === undefined) continue
    let value = fields[key]
    if (key === 'expectedDnsRecords' || key === 'actualDnsRecords') value = JSON.stringify(value ?? [])
    if (key === 'deployReady' || key === 'replacementApproved') value = value ? 1 : 0
    sets.push(`${column} = ?`)
    values.push(value)
  }
  if (sets.length === 0) return getActiveConnection(db, siteId)
  sets.push('updated_at = ?')
  values.push(new Date().toISOString())
  await db
    .prepare(`UPDATE domain_connections SET ${sets.join(', ')} WHERE id = ? AND site_id = ?`)
    .bind(...values, id, siteId)
    .run()
  return getActiveConnection(db, siteId)
}

// 전체 활성 도메인 (운영 현황·Phase 15 Deploy Engine 조회용)
export async function listActiveConnections(db) {
  const { results } = await db
    .prepare(`SELECT ${FIELDS} FROM domain_connections WHERE active = 1 ORDER BY site_id ASC`)
    .bind()
    .all()
  return (results ?? []).map(toConnection)
}

// 과거 이력 (비활성 행 포함, 최신순)
export async function listConnectionHistory(db, siteId, limit = 5) {
  const { results } = await db
    .prepare(`SELECT ${FIELDS} FROM domain_connections WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(siteId, Math.min(20, Math.max(1, limit)))
    .all()
  return (results ?? []).map(toConnection)
}
