-- Article Publishing Engine (Phase 7) — 게시 상태 컬럼 추가
-- 실행 방법: docs/article-publishing-engine.md 참고
--   npx wrangler d1 execute aiseolab-jobs --file=migrations/0003_add_job_publish_fields.sql --remote
--
-- AI 생성 상태(status: queued/running/completed/failed)는 그대로 두고,
-- 게시 상태(publish_status: draft/publishing/published/publish_failed)를
-- 별도 컬럼으로 관리합니다. (기존 컬럼과 중복 없음 — 0001/0002 확인 완료)

ALTER TABLE jobs ADD COLUMN publish_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE jobs ADD COLUMN published_path TEXT;
ALTER TABLE jobs ADD COLUMN published_url TEXT;
ALTER TABLE jobs ADD COLUMN publish_commit_sha TEXT;
ALTER TABLE jobs ADD COLUMN publish_error_message TEXT;
ALTER TABLE jobs ADD COLUMN published_at TEXT;
ALTER TABLE jobs ADD COLUMN publish_started_at TEXT;
