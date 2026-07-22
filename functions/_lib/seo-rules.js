// ============================================================
// SEO 점검 규칙 Registry (Phase 16)
//
// 규칙 1개 = 배열 항목 1개. 형태를 통일해 추가가 쉽습니다:
//   { key, category, label, severity(fail 시), warnSeverity(warning 시),
//     weight(점수 감점), targetModule/action(작업 연결), sitewide,
//     opportunity(내부 콘텐츠 기회 — 검색량·순위 데이터 아님),
//     propagationSensitive(배포 직후 전파 지연 항목 — post_deploy 점검에서 warning 처리),
//     run(ctx) → { status: pass|warning|fail|skipped, detail, affectedUrl?, detected?, expected? } }
//
// ctx는 seo-runner가 조립: 파싱된 페이지(import-html 재사용)·bundle(배포 데이터)·
// 도메인·배포·Import·온보딩 데이터. 규칙 안에서 네트워크 호출은 하지 않습니다.
// ============================================================

const isReal = (value) => typeof value === 'string' && value.trim() !== '' && value.trim() !== '미정'
const home = (ctx) => ctx.pages[0]
const needHome = (ctx) => (home(ctx)?.ok ? null : { status: 'skipped', detail: '대표 페이지 수집 실패로 건너뜁니다.' })

export const SEO_RULES = [
  // ---------- A. Technical (30) ----------
  {
    key: 'home-response', category: 'technical', label: '대표 페이지 응답·HTTPS', severity: 'critical', weight: 30,
    sitewide: true, targetModule: 'deploy', action: '배포 탭에서 [배포 후 검증]으로 원인을 확인하고, 도메인·Pages 연결 상태를 점검하세요.',
    run(ctx) {
      const page = home(ctx)
      if (page?.ok && page.status === 200) return { status: 'pass', detail: 'HTTP 200 · HTTPS 정상' }
      return { status: 'fail', detail: page?.error ?? `HTTP ${page?.status ?? '응답 없음'}`, affectedUrl: page?.url, detected: String(page?.status ?? '연결 실패'), expected: '200' }
    },
  },
  {
    key: 'wrong-site', category: 'technical', label: '병원명 일치(다른 사이트 감지)', severity: 'critical', weight: 30,
    sitewide: true, targetModule: 'deploy', action: 'Pages 프로젝트의 SITE 환경변수와 도메인 연결을 즉시 확인하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const name = ctx.bundle?.name ?? ''
      if (name === '') return { status: 'skipped', detail: '병원명 데이터가 없습니다.' }
      return home(ctx).text.includes(name)
        ? { status: 'pass', detail: `병원명(${name}) 확인` }
        : { status: 'fail', detail: '페이지에 병원명이 없습니다 — 다른 사이트가 표시되고 있을 수 있습니다.', affectedUrl: home(ctx).url, detected: home(ctx).title, expected: name }
    },
  },
  {
    key: 'noindex', category: 'technical', label: 'noindex 오설정', severity: 'critical', weight: 15,
    sitewide: true, targetModule: 'manual', action: '홈페이지에 noindex가 설정되어 있습니다. BaseLayout·배포 설정을 확인해 즉시 제거하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      return home(ctx).hasNoindex
        ? { status: 'fail', detail: '홈페이지 meta robots에 noindex — 검색 제외 상태입니다.', affectedUrl: home(ctx).url }
        : { status: 'pass', detail: '정상' }
    },
  },
  {
    key: 'robots-blocked', category: 'technical', label: 'robots.txt 전체 차단', severity: 'critical', weight: 12,
    sitewide: true, targetModule: 'manual', action: 'robots.txt의 Disallow: / 를 제거해야 검색 노출이 가능합니다.',
    run(ctx) {
      if (!ctx.robots.ok) return { status: 'warning', detail: 'robots.txt를 확인하지 못했습니다.' }
      return ctx.robots.disallowAll
        ? { status: 'fail', detail: 'User-agent: * 전체 차단(Disallow: /) 상태입니다.' }
        : { status: 'pass', detail: '정상' }
    },
  },
  {
    key: 'canonical', category: 'technical', label: 'canonical 존재·일치', severity: 'high', weight: 8,
    targetModule: 'settings', action: '사이트 설정의 site.url이 운영 도메인과 일치하는지 확인 후 재배포하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const canonical = home(ctx).canonical
      if (!canonical) return { status: 'fail', detail: 'canonical 태그가 없습니다.', affectedUrl: home(ctx).url }
      let host = ''
      try { host = new URL(canonical).hostname } catch { host = '' }
      const expect = ctx.host
      const match = host === expect || host === `www.${expect}` || `www.${host}` === expect
      return match
        ? { status: 'pass', detail: canonical }
        : { status: 'fail', detail: `canonical(${canonical})이 운영 도메인(${expect})과 다릅니다.`, affectedUrl: home(ctx).url, detected: canonical, expected: `https://${expect}/` }
    },
  },
  {
    key: 'sitemap-exists', category: 'technical', label: 'sitemap.xml', severity: 'medium', weight: 5, propagationSensitive: true,
    targetModule: 'deploy', action: '재배포 후에도 없으면 빌드 로그를 확인하세요. 정상 빌드에는 자동 포함됩니다.',
    run(ctx) {
      return ctx.sitemap.ok
        ? { status: 'pass', detail: `URL ${ctx.sitemap.urlCount}개` }
        : { status: 'fail', detail: 'sitemap.xml을 확인하지 못했습니다.' }
    },
  },
  {
    key: 'title-desc', category: 'technical', label: 'title·description', severity: 'high', weight: 6,
    targetModule: 'settings', action: '사이트 설정에서 SEO 제목·설명을 입력하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const page = home(ctx)
      if (page.title === '') return { status: 'fail', detail: 'title이 없습니다.', affectedUrl: page.url }
      if ((page.meta.description ?? '') === '') return { status: 'warning', detail: 'meta description이 없습니다.', affectedUrl: page.url }
      return { status: 'pass', detail: page.title.slice(0, 60) }
    },
  },
  {
    key: 'h1', category: 'technical', label: 'H1 존재', severity: 'low', warnSeverity: 'low', weight: 2,
    targetModule: 'settings', action: 'Hero 제목(H1)이 비어 있지 않은지 확인하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      return home(ctx).h1Count > 0 ? { status: 'pass', detail: `H1 ${home(ctx).h1Count}개` } : { status: 'warning', detail: '대표 페이지에 H1이 없습니다.', affectedUrl: home(ctx).url }
    },
  },
  {
    key: 'viewport', category: 'technical', label: '모바일 viewport', severity: 'low', weight: 2,
    targetModule: 'manual', action: 'BaseLayout의 viewport meta를 확인하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      return home(ctx).hasViewport ? { status: 'pass', detail: '정상' } : { status: 'fail', detail: 'viewport meta가 없습니다 — 모바일 표시에 문제가 생깁니다.', affectedUrl: home(ctx).url }
    },
  },
  {
    key: 'img-alt', category: 'technical', label: '이미지 alt', severity: 'low', weight: 2,
    targetModule: 'entity', action: '의료진·시설 이미지의 대체 텍스트(alt)를 입력하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const missing = ctx.pages.filter((p) => p.ok).reduce((sum, p) => sum + p.images.filter((img) => img.alt === '').length, 0)
      return missing === 0
        ? { status: 'pass', detail: '정상' }
        : { status: 'warning', detail: `alt 없는 이미지 ${missing}개`, detected: String(missing), expected: '0' }
    },
  },
  {
    key: 'broken-links', category: 'technical', label: '깨진 주요 내부 링크', severity: 'medium', weight: 5,
    targetModule: 'content', action: '404가 나는 내부 링크를 수정하거나 해당 콘텐츠를 복구하세요.',
    run(ctx) {
      if (ctx.brokenLinks === null) return { status: 'skipped', detail: '내부 링크 표본을 확인하지 못했습니다.' }
      return ctx.brokenLinks.length === 0
        ? { status: 'pass', detail: `표본 ${ctx.checkedLinkCount}개 정상` }
        : { status: 'fail', detail: `깨진 링크 ${ctx.brokenLinks.length}개: ${ctx.brokenLinks.map((l) => l.path).slice(0, 3).join(', ')}`, affectedUrl: ctx.brokenLinks[0].url }
    },
  },
  {
    key: 'page-weight', category: 'technical', label: '페이지 크기', severity: 'low', weight: 2,
    targetModule: 'manual', action: '대표 페이지가 큽니다. 이미지 최적화를 검토하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const kb = Math.round(home(ctx).bytes / 1024)
      return kb > 800 ? { status: 'warning', detail: `대표 페이지 ${kb}KB (800KB 초과)`, detected: `${kb}KB` } : { status: 'pass', detail: `${kb}KB` }
    },
  },

  // ---------- B. Content (25) ----------
  {
    key: 'content-count', category: 'content', label: '콘텐츠 수량', severity: 'medium', weight: 6,
    targetModule: 'content', action: '생성 작업 탭에서 새 콘텐츠를 작성하세요. (검토 후 게시)',
    run(ctx) {
      const count = ctx.bundle?.articles?.length ?? 0
      if (count === 0) return { status: 'fail', detail: '게시된 콘텐츠가 없습니다.', detected: '0', expected: '3개 이상' }
      if (count < 3) return { status: 'warning', detail: `콘텐츠 ${count}개 — 3개 이상 권장`, detected: String(count) }
      return { status: 'pass', detail: `${count}개` }
    },
  },
  {
    key: 'content-stale', category: 'content', label: '최근 발행일', severity: 'medium', weight: 6,
    targetModule: 'content', action: '생성 작업 탭에서 새 콘텐츠를 작성해 발행 주기를 유지하세요.',
    run(ctx) {
      const dates = (ctx.bundle?.articles ?? []).map((a) => Date.parse(a.date ?? '')).filter((t) => !Number.isNaN(t))
      if (dates.length === 0) return { status: 'skipped', detail: '발행일 데이터가 없습니다.' }
      const days = Math.floor((ctx.now - Math.max(...dates)) / 86_400_000)
      return days > ctx.config.staleDays
        ? { status: 'fail', detail: `최근 ${days}일간 새 콘텐츠가 없습니다. (기준 ${ctx.config.staleDays}일)`, detected: `${days}일`, expected: `${ctx.config.staleDays}일 이내` }
        : { status: 'pass', detail: `마지막 발행 ${days}일 전` }
    },
  },
  {
    key: 'content-thin', category: 'content', label: '본문 분량', severity: 'low', weight: 4,
    targetModule: 'content', action: '분량이 짧은 페이지의 본문을 보강하세요.',
    run(ctx) {
      const thin = ctx.pages.filter((p) => p.ok && p.isContent && p.textLength < ctx.config.minWords)
      return thin.length === 0
        ? { status: 'pass', detail: '정상' }
        : { status: 'warning', detail: `본문이 짧은 페이지 ${thin.length}개 (기준 ${ctx.config.minWords}자)`, affectedUrl: thin[0].url }
    },
  },
  {
    key: 'hospital-info', category: 'content', label: '병원 기본 정보(전화·주소·시간)', severity: 'medium', weight: 5,
    targetModule: 'onboarding', action: '온보딩 [관리] 또는 사이트 설정에서 전화·주소·진료시간을 입력하세요.',
    run(ctx) {
      const b = ctx.bundle ?? {}
      const missing = []
      if (!isReal(b.phone)) missing.push('전화')
      if (!isReal(b.address)) missing.push('주소')
      if (!isReal(b.hours?.weekday)) missing.push('진료시간')
      return missing.length === 0 ? { status: 'pass', detail: '정상' } : { status: 'fail', detail: `미입력: ${missing.join(', ')}`, detected: missing.join(','), expected: '전체 입력' }
    },
  },
  {
    key: 'doctors-info', category: 'content', label: '의료진 정보', severity: 'medium', weight: 4,
    targetModule: 'entity', action: 'SEO 엔티티 탭에서 의료진을 등록하세요. (Import 후보 활용 가능)',
    run(ctx) {
      const doctors = ctx.bundle?.doctors?.length ?? 0
      const legacy = ctx.bundle?.doctor
      if (doctors > 0) return { status: 'pass', detail: `의료진 ${doctors}명` }
      if (legacy && typeof legacy === 'object' && isReal(legacy.name)) return { status: 'warning', detail: '대표원장만 등록됨 — 엔티티 등록 권장' }
      return { status: 'fail', detail: '의료진 정보가 없습니다.' }
    },
  },
  {
    key: 'faq-exists', category: 'content', label: 'FAQ', severity: 'low', weight: 3,
    targetModule: 'settings', action: '사이트 설정 또는 Import 결과의 FAQ를 적용하세요.',
    run(ctx) {
      const count = ctx.bundle?.faq?.length ?? 0
      return count > 0 ? { status: 'pass', detail: `${count}개` } : { status: 'fail', detail: 'FAQ가 없습니다.' }
    },
  },
  // 내부 콘텐츠 기회 (검색량·순위 데이터가 아님)
  {
    key: 'opp-dept-content', category: 'content', label: '[기회] 진료과 관련 콘텐츠 없음', severity: 'info', weight: 0, opportunity: true,
    targetModule: 'content', action: '해당 진료과 주제로 콘텐츠를 작성하면 내부 연결이 생깁니다. (내부 콘텐츠 기회 — 검색량 데이터 아님)',
    run(ctx) {
      const departments = ctx.bundle?.departments ?? []
      if (departments.length === 0) return { status: 'skipped', detail: '진료과 엔티티가 없습니다.' }
      const text = (ctx.bundle?.articles ?? []).map((a) => `${a.title} ${a.summary ?? ''}`).join(' ')
      const uncovered = departments.filter((dept) => !text.includes(dept.name.replace(/센터|클리닉/g, '').trim().slice(0, 4)))
      return uncovered.length === 0
        ? { status: 'pass', detail: '모든 진료과에 관련 콘텐츠가 있습니다.' }
        : { status: 'fail', detail: `관련 콘텐츠 없는 진료과: ${uncovered.map((d) => d.name).join(', ')}`, detected: `${uncovered.length}개` }
    },
  },
  {
    key: 'opp-doctor-link', category: 'content', label: '[기회] 의료진 전문 분야 미입력', severity: 'info', weight: 0, opportunity: true,
    targetModule: 'entity', action: '의료진 전문 분야(specialties)를 입력하면 상세 페이지·Schema가 풍부해집니다.',
    run(ctx) {
      const doctors = ctx.bundle?.doctors ?? []
      if (doctors.length === 0) return { status: 'skipped', detail: '의료진 엔티티가 없습니다.' }
      const empty = doctors.filter((doc) => (doc.specialties?.length ?? 0) === 0 && (doc.bio ?? '') === '')
      return empty.length === 0 ? { status: 'pass', detail: '정상' } : { status: 'fail', detail: `전문 분야·소개 미입력 의료진 ${empty.length}명: ${empty.map((d) => d.name).join(', ')}` }
    },
  },

  // ---------- C. Entity / Structured Data (20) ----------
  {
    key: 'clinic-schema', category: 'entity', label: '대표 Schema(MedicalClinic 등)', severity: 'medium', weight: 7,
    targetModule: 'settings', action: '사이트 설정의 schema 유형과 빌드 결과를 확인하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      return home(ctx).jsonLd.length > 0
        ? { status: 'pass', detail: `JSON-LD ${home(ctx).jsonLd.length}개` }
        : { status: 'fail', detail: '대표 페이지에 구조화 데이터가 없습니다.', affectedUrl: home(ctx).url }
    },
  },
  {
    key: 'entity-links', category: 'entity', label: '진료과↔의료진 연결', severity: 'medium', weight: 5,
    targetModule: 'entity', action: 'SEO 엔티티 탭에서 소속 진료과를 연결하세요.',
    run(ctx) {
      const doctors = ctx.bundle?.doctors ?? []
      const departments = ctx.bundle?.departments ?? []
      if (doctors.length === 0 && departments.length === 0) return { status: 'skipped', detail: '엔티티가 없습니다.' }
      const unlinkedDoctors = doctors.filter((doc) => (doc.departmentIds?.length ?? 0) === 0).length
      const unlinkedDepts = departments.filter((dept) => (dept.doctorIds?.length ?? 0) === 0).length
      return unlinkedDoctors + unlinkedDepts === 0
        ? { status: 'pass', detail: '정상' }
        : { status: 'warning', detail: `연결 없는 의료진 ${unlinkedDoctors}명 · 진료과 ${unlinkedDepts}개` }
    },
  },
  {
    key: 'info-consistency', category: 'entity', label: '화면·데이터 일관성(전화)', severity: 'high', weight: 8,
    targetModule: 'settings', action: '사이트 설정의 전화번호와 화면 표시가 다릅니다. 설정을 수정하고 재배포하세요.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const phone = ctx.bundle?.phone
      if (!isReal(phone)) return { status: 'skipped', detail: '전화번호 데이터가 없습니다.' }
      const digits = phone.replace(/[^\d]/g, '')
      const pageDigits = home(ctx).text.replace(/[^\d]/g, '')
      return pageDigits.includes(digits)
        ? { status: 'pass', detail: '정상' }
        : { status: 'fail', detail: `화면에 등록된 전화번호(${phone})가 보이지 않습니다.`, detected: '미표시', expected: phone }
    },
  },

  // ---------- D. Conversion (15) ----------
  {
    key: 'no-cta', category: 'conversion', label: '전화·예약 CTA 전무', severity: 'critical', weight: 10,
    sitewide: true, targetModule: 'onboarding', action: '전환정보(전화·예약 URL)를 온보딩 또는 사이트 설정에서 입력하세요. 전환 수단이 전혀 없는 상태입니다.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const page = home(ctx)
      const hasBooking = page.links.some((l) => /booking\.naver\.com|pf\.kakao\.com/i.test(l.url))
      return page.hasTelLink || hasBooking
        ? { status: 'pass', detail: '정상' }
        : { status: 'fail', detail: '전화(tel:)·예약·카카오 링크가 하나도 없습니다.', affectedUrl: page.url }
    },
  },
  {
    key: 'booking-cta', category: 'conversion', label: '예약 CTA', severity: 'medium', weight: 3,
    targetModule: 'onboarding', action: '예약 URL을 등록하면 전화 외 전환 경로가 생깁니다.',
    run(ctx) {
      const skip = needHome(ctx); if (skip) return skip
      const hasBooking = home(ctx).links.some((l) => /booking\.naver\.com|pf\.kakao\.com/i.test(l.url)) || isReal(ctx.bundle?.channels?.naverBooking)
      return hasBooking ? { status: 'pass', detail: '정상' } : { status: 'warning', detail: '예약·상담 링크가 없습니다.' }
    },
  },
  {
    key: 'booking-valid', category: 'conversion', label: '예약 URL 응답', severity: 'high', weight: 4, propagationSensitive: true,
    targetModule: 'onboarding', action: '예약 URL이 응답하지 않습니다. 링크를 확인·수정하세요.',
    run(ctx) {
      if (!ctx.bookingCheck) return { status: 'skipped', detail: '등록된 예약 URL이 없습니다.' }
      return ctx.bookingCheck.ok
        ? { status: 'pass', detail: '예약 URL 응답 정상' }
        : { status: 'fail', detail: `예약 URL이 응답하지 않습니다 (${ctx.bookingCheck.status || '연결 실패'})`, affectedUrl: ctx.bookingCheck.url, detected: String(ctx.bookingCheck.status) }
    },
  },
  {
    key: 'map-cta', category: 'conversion', label: '지도 CTA', severity: 'low', weight: 2,
    targetModule: 'onboarding', action: '네이버지도 URL을 등록하면 방문 전환에 도움이 됩니다.',
    run(ctx) {
      return isReal(ctx.bundle?.channels?.naverMap)
        ? { status: 'pass', detail: '정상' }
        : { status: 'warning', detail: '지도 링크가 없습니다.' }
    },
  },

  // ---------- E. Operations (10) ----------
  {
    key: 'deploy-health', category: 'operations', label: '최근 배포 상태', severity: 'high', weight: 4,
    targetModule: 'deploy', action: '배포 탭에서 실패 원인을 확인하세요.',
    run(ctx) {
      if (ctx.deploys.recentFailure) return { status: 'fail', detail: `최근 배포 실패 (${ctx.deploys.recentFailure.errorCode || '원인 미상'})`, detected: ctx.deploys.recentFailure.status }
      if (!ctx.deploys.lastSuccess) return { status: 'warning', detail: '성공한 배포 기록이 없습니다.' }
      return { status: 'pass', detail: `마지막 성공 ${String(ctx.deploys.lastSuccess.completedAt ?? '').slice(0, 10)}` }
    },
  },
  {
    key: 'domain-health', category: 'operations', label: '도메인·DNS·HTTPS 상태', severity: 'high', weight: 3, propagationSensitive: true,
    targetModule: 'domain', action: '도메인 탭에서 [다시 검증]을 실행하세요.',
    run(ctx) {
      const conn = ctx.connection
      if (!conn) return { status: 'skipped', detail: '활성 도메인이 없습니다.' }
      if (conn.dnsStatus === 'ok' && conn.httpsStatus === 'ok') return { status: 'pass', detail: '정상' }
      return { status: 'fail', detail: `DNS ${conn.dnsStatus} · HTTPS ${conn.httpsStatus}`, detected: conn.verificationStatus }
    },
  },
  {
    key: 'domain-expiry', category: 'operations', label: '도메인 만료 예정', severity: 'high', weight: 2,
    targetModule: 'domain', action: '등록기관에서 도메인을 갱신하세요. 만료 시 사이트 전체가 중단됩니다.',
    run(ctx) {
      const expiry = ctx.connection?.expiryDate
      if (!expiry) return { status: 'skipped', detail: '만료일이 등록되지 않았습니다.' }
      const days = Math.floor((Date.parse(expiry) - ctx.now) / 86_400_000)
      if (Number.isNaN(days)) return { status: 'skipped', detail: '만료일 형식 오류' }
      if (days < 0) return { status: 'fail', detail: `도메인이 만료되었습니다 (${expiry})`, detected: expiry }
      if (days <= 30) return { status: 'fail', detail: `도메인 만료 ${days}일 전 (${expiry})`, detected: expiry }
      return { status: 'pass', detail: `만료까지 ${days}일` }
    },
  },
  {
    key: 'import-missing', category: 'operations', label: 'Import 누락 자료', severity: 'info', weight: 0, opportunity: true,
    targetModule: 'import', action: 'Import 결과의 "추가로 필요한 자료"를 병원에 요청하세요.',
    run(ctx) {
      const missing = ctx.importJob?.result?.missing ?? []
      if (!ctx.importJob) return { status: 'skipped', detail: 'Import 이력이 없습니다.' }
      return missing.length === 0 ? { status: 'pass', detail: '정상' } : { status: 'fail', detail: `병원에 요청할 자료: ${missing.join(', ')}` }
    },
  },
  {
    key: 'onboarding-remain', category: 'operations', label: '온보딩 잔여 작업', severity: 'low', weight: 1,
    targetModule: 'onboarding', action: '온보딩 [관리]에서 남은 작업 체크를 완료하세요.',
    run(ctx) {
      const percent = ctx.onboarding?.progress?.percent
      if (percent === undefined) return { status: 'skipped', detail: '온보딩 레코드가 없습니다.' }
      return percent >= 100 ? { status: 'pass', detail: '완료' } : { status: 'warning', detail: `온보딩 진행률 ${percent}%` }
    },
  },
]

// post_deploy 점검: 전파 민감 항목의 fail을 warning으로 완화 (즉시 실패 단정 금지)
export function applyPostDeploySoftening(ruleKey, result, isPostDeploy) {
  if (!isPostDeploy || result.status !== 'fail') return result
  const rule = SEO_RULES.find((r) => r.key === ruleKey)
  if (!rule?.propagationSensitive) return result
  return { ...result, status: 'warning', detail: `${result.detail} (배포 직후 전파 지연일 수 있음 — 잠시 후 재점검)` }
}
