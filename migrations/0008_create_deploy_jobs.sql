-- Phase 15: Deploy Engine
-- 배포 작업 이력 + 사이트별 배포 설정.
-- 현재 배포 구조(공유 GitHub 저장소 + 사이트별 Cloudflare Pages 프로젝트,
-- push 시 자동 빌드)는 그대로 유지하며, 이 테이블은 실행·추적·검증 기록입니다.
--
-- deployment_type: preview | production | replace
-- status: queued | validating | building | deploying | verifying |
--         success | partial_success | failed | cancelled | rolled_back
--   (functions/_lib/deploy-status.js 한 곳에서 관리)
-- 토큰 등 민감정보는 저장하지 않습니다.

CREATE TABLE IF NOT EXISTS deploy_jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  deployment_type TEXT NOT NULL DEFAULT 'preview',
  status TEXT NOT NULL DEFAULT 'queued',
  target_domain TEXT NOT NULL DEFAULT '',
  operation_mode TEXT NOT NULL DEFAULT 'independent',

  git_branch TEXT NOT NULL DEFAULT '',
  git_commit_sha TEXT NOT NULL DEFAULT '',
  pages_project TEXT NOT NULL DEFAULT '',
  pages_deployment_id TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  production_url TEXT NOT NULL DEFAULT '',

  preflight_result TEXT,      -- JSON (검사 항목·pass/warning/fail/skipped·계획 요약)
  deployment_result TEXT,     -- JSON (트리거 결과·수동 모드 여부·Pages 상태 이력)
  verification_result TEXT,   -- JSON (배포 후 검증 체크 목록)
  rollback_source_id TEXT NOT NULL DEFAULT '',  -- 이 작업을 되돌릴 때 참조한 이전 성공 배포 id
  rollback_reason TEXT NOT NULL DEFAULT '',

  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deploy_jobs_site ON deploy_jobs (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deploy_jobs_active ON deploy_jobs (site_id, status);

-- 사이트별 배포 설정 (없으면 env 기본값 사용: CLOUDFLARE_PAGES_PROJECT / GITHUB_BRANCH)
-- deployment_strategy: shared(공유 저장소·브랜치 — 빌드가 다른 사이트 프로젝트에도 영향) | isolated
CREATE TABLE IF NOT EXISTS site_deploy_config (
  site_id TEXT PRIMARY KEY,
  pages_project TEXT NOT NULL DEFAULT '',
  git_branch TEXT NOT NULL DEFAULT '',
  production_branch TEXT NOT NULL DEFAULT '',
  build_command TEXT NOT NULL DEFAULT '',
  output_directory TEXT NOT NULL DEFAULT '',
  deployment_strategy TEXT NOT NULL DEFAULT 'shared',
  updated_at TEXT NOT NULL
);
