-- Deployment Verification & Published Article Management (Phase 8)
-- 실행 방법: docs/published-article-management.md 참고
--   npx wrangler d1 execute aiseolab-jobs --file=migrations/0004_add_deployment_fields.sql --remote
--
-- 설계: publish_status(게시 수명주기)는 그대로 두고,
--       실제 배포 반영 여부는 별도 deployment_status로 관리합니다.
--   publish_status:    draft / publishing / published / publish_failed / deleted(신규)
--   deployment_status: pending(기본) / deployed / deploy_failed
-- 기존 published 행은 deployment_status='pending'으로 시작하므로
-- "배포 상태 확인"을 한 번 실행하면 deployed로 갱신됩니다. (하위 호환 — 데이터 깨짐 없음)
-- (0001~0003과 중복되는 컬럼 없음 — 확인 완료)

ALTER TABLE jobs ADD COLUMN deployment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE jobs ADD COLUMN deployment_checked_at TEXT;
ALTER TABLE jobs ADD COLUMN deployment_error_message TEXT;
ALTER TABLE jobs ADD COLUMN deployment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN deleted_at TEXT;
ALTER TABLE jobs ADD COLUMN updated_commit_sha TEXT;
ALTER TABLE jobs ADD COLUMN article_updated_at TEXT;
