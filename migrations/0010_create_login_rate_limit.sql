-- 로그인 반복 시도 방어 (anti-brute-force)
-- 고정 윈도우(fixed window) 카운터 — bucket_key = "<ip>:<windowStart>" 이므로
-- 윈도우가 바뀌면 자동으로 새 행이 생성되고, 이전 윈도우 행은 조회 대상에서
-- 자연히 제외됩니다(운영상 필요하면 오래된 행은 별도 정리 스크립트로 삭제 가능).

CREATE TABLE IF NOT EXISTS login_rate_limit (
  bucket_key TEXT PRIMARY KEY,       -- "<ip>:<windowStart>"
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,     -- 윈도우 시작 시각 (ms epoch)
  attempt_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_rate_limit_window ON login_rate_limit (window_start);
