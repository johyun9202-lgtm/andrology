-- Job 실행 엔진 (Phase 6) — 실행 시각 컬럼 추가
-- 실행 방법: docs/ai-writer-engine.md 참고
--   npx wrangler d1 execute aiseolab-jobs --file=migrations/0002_add_job_run_timestamps.sql --remote
--
-- status / result / error / updated_at 컬럼은 0001에서 이미 생성되어 있으므로
-- 이 파일은 실행 시작·완료 시각 두 개만 추가합니다.

ALTER TABLE jobs ADD COLUMN started_at TEXT;
ALTER TABLE jobs ADD COLUMN completed_at TEXT;
