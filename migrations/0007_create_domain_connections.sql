-- Phase 14C: Domain Wizard
-- 병원(사이트)별 도메인 연결 상태 — 내부 운영 데이터.
-- 도메인 자동 구매·무단 DNS 변경 기능은 없으며, 검증 결과만 기록합니다.
--
-- active: site_id별 "현재 사용 도메인"은 1행만 active=1 (새 도메인 저장 시
--         이전 행은 active=0으로 남겨 과거 상태·검증 이력을 보존)
-- verification_status: undecided | domain_entered | dns_instructions_ready |
--   dns_pending | dns_mismatch | pages_pending | https_pending | verified |
--   manual_review | error  (functions/_lib/domain-status.js 한 곳에서 관리)
-- 민감한 비밀번호·인증 코드는 저장하지 않습니다.

CREATE TABLE IF NOT EXISTS domain_connections (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  domain_type TEXT NOT NULL DEFAULT 'apex',            -- apex | www | subdomain
  operation_mode TEXT NOT NULL DEFAULT 'independent',  -- independent | replace | subdomain

  -- 관리 주체 (Step 3)
  management_type TEXT NOT NULL DEFAULT 'unknown',     -- client_managed | company_managed | unknown
  registrar_name TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  auto_renew_status TEXT NOT NULL DEFAULT 'unknown',   -- on | off | unknown
  nameserver_status TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',

  -- DNS 안내·검증 (Step 4~5)
  expected_dns_records TEXT NOT NULL DEFAULT '[]',     -- JSON
  actual_dns_records TEXT NOT NULL DEFAULT '[]',       -- JSON (마지막 검증 결과)
  dns_status TEXT NOT NULL DEFAULT 'unchecked',        -- unchecked | pending | ok | mismatch | manual | error
  pages_status TEXT NOT NULL DEFAULT 'unchecked',      -- unchecked | manual | pending | connected | error
  https_status TEXT NOT NULL DEFAULT 'unchecked',      -- unchecked | pending | ok | error
  verification_status TEXT NOT NULL DEFAULT 'domain_entered',
  last_checked_at TEXT,
  error_message TEXT NOT NULL DEFAULT '',

  -- 배포 준비 (Step 6 — Phase 15 Deploy Engine이 조회)
  deploy_ready INTEGER NOT NULL DEFAULT 0,
  replacement_approved INTEGER NOT NULL DEFAULT 0,     -- replace 모드 전환 승인

  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_connections_site ON domain_connections (site_id, active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_connections_domain ON domain_connections (domain, active);
