-- Phase 14B: Hospital Import Engine
-- 기존 홈페이지 수집 결과의 "원본 기록" — hospital.json에는 절대 바로 저장하지 않고,
-- 검토 화면에서 선택·수정·승인한 항목만 별도 apply API로 병합합니다.
--
-- status: running | completed | partial_success | failed
-- result: JSON { candidates: [...], pages: [...], score: {...}, missing: [...] }
--   candidate = { fieldKey, value, confidence(high|medium|low), sourceUrl, sourceText }
--   (추출 근거 sourceUrl/sourceText 없는 값은 저장하지 않음 — 추측 금지 원칙)
-- applied_at / applied_fields: 검토 후 적용 이력 (재실행 시 과거 기록 확인용)

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error_message TEXT,
  applied_at TEXT,
  applied_fields TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_site ON import_jobs (site_id, created_at DESC);
