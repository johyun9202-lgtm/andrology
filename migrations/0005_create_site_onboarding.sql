-- Phase 14A: Client Onboarding Engine
-- 병원(클라이언트)별 온보딩 정보 — 내부 운영 데이터이므로 저장소(hospital.json)가 아닌 D1에 보관합니다.
-- (새로 생성한 사이트는 재배포 전에도 이 테이블 기준으로 즉시 조회·진행률 표시가 가능합니다)
--
-- stage: 운영 파이프라인 단계 — Phase 14B(Import)/14C(Domain)/15(Deploy)/16(SEO Operation)에서 확장
--   onboarding → import → domain → deploy → operating
-- checklist: 작업 체크 JSON (키: logo, photos, reservation, map, phone, domain — 값: 0/1)

CREATE TABLE IF NOT EXISTS site_onboarding (
  site_id TEXT PRIMARY KEY,
  hospital_name TEXT NOT NULL,
  manager_name TEXT NOT NULL DEFAULT '',
  manager_phone TEXT NOT NULL DEFAULT '',
  manager_email TEXT NOT NULL DEFAULT '',

  -- 운영방식: independent(독립 SEO 홍보사이트, 기본) | replace(기존 홈페이지 교체) | subdomain(서브도메인 운영)
  operation_mode TEXT NOT NULL DEFAULT 'independent',

  -- 기존 홈페이지 URL (Phase 14B Hospital Import Engine의 수집 대상)
  existing_url TEXT NOT NULL DEFAULT '',

  -- 전환정보 (사이트 방문자 → 예약·상담 전환 채널)
  reservation_url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  naver_map_url TEXT NOT NULL DEFAULT '',
  kakao_channel_url TEXT NOT NULL DEFAULT '',

  -- 새 도메인: domain_status = undecided(미정) | decided(입력됨)
  --   Phase 14C Domain Wizard에서 requested/connected/verified 등으로 확장 예정
  new_domain TEXT NOT NULL DEFAULT '',
  domain_status TEXT NOT NULL DEFAULT 'undecided',

  -- 작업 체크 (JSON) + 파이프라인 단계
  checklist TEXT NOT NULL DEFAULT '{}',
  stage TEXT NOT NULL DEFAULT 'onboarding',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_onboarding_stage ON site_onboarding (stage);
