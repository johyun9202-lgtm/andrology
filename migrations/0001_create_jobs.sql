-- Job Engine v1 — jobs 테이블
-- 실행 방법: docs/job-engine.md 참고
--   npx wrangler d1 execute aiseolab-jobs --file=migrations/0001_create_jobs.sql --remote

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  site TEXT NOT NULL,
  keyword TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
