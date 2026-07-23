-- Phase 16: AI SEO Operations Center
-- 운영 중(stage=operating) 병원 사이트의 정기 점검·문제·작업 관리.
-- 원본 HTML 전체·민감정보는 저장하지 않으며 결과 JSON은 크기를 제한해 기록합니다.

-- 점검 실행 이력
CREATE TABLE IF NOT EXISTS seo_check_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',   -- queued|running|completed|partial_success|failed
  trigger_type TEXT NOT NULL DEFAULT 'manual', -- manual|scheduled|post_deploy
  pages_checked INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  overall_score INTEGER NOT NULL DEFAULT 0,
  technical_score INTEGER NOT NULL DEFAULT 0,
  content_score INTEGER NOT NULL DEFAULT 0,
  entity_score INTEGER NOT NULL DEFAULT 0,
  conversion_score INTEGER NOT NULL DEFAULT 0,
  operations_score INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,                          -- 규칙별 결과 요약 (근거 일부 — 전체 HTML 저장 금지)
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seo_runs_site ON seo_check_runs (site_id, created_at DESC);

-- 발견 항목 (fingerprint = site:rule:url 로 중복 생성 방지, 이력 보존)
CREATE TABLE IF NOT EXISTS seo_findings (
  id TEXT PRIMARY KEY,
  check_run_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,                    -- technical|content|entity|conversion|operations
  rule_key TEXT NOT NULL,
  severity TEXT NOT NULL,                    -- critical|high|medium|low|info
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  affected_url TEXT NOT NULL DEFAULT '',
  detected_value TEXT NOT NULL DEFAULT '',
  expected_value TEXT NOT NULL DEFAULT '',
  evidence_json TEXT,
  is_opportunity INTEGER NOT NULL DEFAULT 0, -- 내부 콘텐츠 기회 (검색량·순위 데이터 아님)
  status TEXT NOT NULL DEFAULT 'open',       -- open|acknowledged|in_progress|resolved|ignored|reopened
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seo_findings_site ON seo_findings (site_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_findings_fp ON seo_findings (fingerprint);

-- 작업 (Action Center — finding 1건당 열린 작업 1건)
CREATE TABLE IF NOT EXISTS seo_tasks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  finding_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  priority_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  target_module TEXT NOT NULL DEFAULT 'manual', -- onboarding|import|entity|content|domain|deploy|settings|manual
  target_route TEXT NOT NULL DEFAULT '',
  affected_url TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  auto_fixable INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_site ON seo_tasks (site_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_priority ON seo_tasks (status, priority_score DESC);

-- 사이트별 점검 설정
CREATE TABLE IF NOT EXISTS site_seo_settings (
  site_id TEXT PRIMARY KEY,
  check_enabled INTEGER NOT NULL DEFAULT 1,
  max_pages INTEGER NOT NULL DEFAULT 0,        -- 0 = env 기본값 사용
  stale_content_days INTEGER NOT NULL DEFAULT 0,
  minimum_content_length INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
