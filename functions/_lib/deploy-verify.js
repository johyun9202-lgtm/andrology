// ============================================================
// 배포 후 검증 — 실제 URL 확인 (Phase 15)
//
// "배포 완료 신호"만으로 성공 처리하지 않고 실제 응답을 검사합니다.
// 심각 항목(응답 실패·다른 사이트 표시·canonical 불일치·robots 전체 차단)은
// failed, 보조 항목(sitemap·Schema·CTA 미확인)은 partial_success.
// 테스트 전용 재정의: DEPLOY_VERIFY_BASE_URL (실서버 미설정)
// ============================================================

function buildUrl(env, host, path) {
  const override = typeof env?.DEPLOY_VERIFY_BASE_URL === 'string' ? env.DEPLOY_VERIFY_BASE_URL.trim() : ''
  return override !== '' ? `${override.replace(/\/$/, '')}/${host}${path}` : `https://${host}${path}`
}

async function fetchText(env, host, path, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(buildUrl(env, host, path), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html,application/xml,text/plain', 'user-agent': 'aiseolab-deploy-verify/1.0' },
    })
    const text = await response.text().catch(() => '')
    return { ok: true, status: response.status, finalUrl: response.url || buildUrl(env, host, path), text: text.slice(0, 400_000), redirected: response.redirected }
  } catch (e) {
    return {
      ok: false, status: 0, finalUrl: buildUrl(env, host, path), text: '',
      error: e?.name === 'AbortError' ? '응답 시간 초과' : /redirect/i.test(String(e?.message ?? '')) ? '리디렉션 루프/횟수 초과' : 'HTTPS 연결 실패',
    }
  } finally {
    clearTimeout(timer)
  }
}

function finalHostOf(env, result) {
  const override = typeof env?.DEPLOY_VERIFY_BASE_URL === 'string' ? env.DEPLOY_VERIFY_BASE_URL.trim() : ''
  try {
    const url = new URL(result.finalUrl)
    if (override === '') return url.hostname.toLowerCase()
    return (url.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase()
  } catch {
    return ''
  }
}

// verifyDeployment(env, { host, expectedName, expectedCanonicalHost, isPreview })
// 반환: { status: 'success'|'partial_success'|'failed', checks: [...], finalUrl }
export async function verifyDeployment(env, { host, expectedName, expectedCanonicalHost, isPreview = false }) {
  const timeoutMs = Number(env?.DEPLOY_VERIFY_TIMEOUT_MS) > 0 ? Number(env.DEPLOY_VERIFY_TIMEOUT_MS) : 10_000
  const checks = []
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail })

  // 1) 대표 페이지
  const home = await fetchText(env, host, '/', timeoutMs)
  if (!home.ok) {
    add('home', '대표 페이지 응답', 'fail', `${home.error} — DNS·HTTPS·Pages 연결 상태를 확인해 주세요.`)
    return { status: 'failed', checks, finalUrl: home.finalUrl }
  }
  if (home.status !== 200) {
    add('home', '대표 페이지 응답', 'fail', `HTTP ${home.status} — 빌드 실패 또는 도메인 연결 문제일 수 있습니다.`)
    return { status: 'failed', checks, finalUrl: home.finalUrl }
  }
  add('home', '대표 페이지 응답', 'pass', 'HTTP 200 · HTTPS 정상')

  // 최종 도메인 일치 (redirect 이탈 감지)
  const finalHost = finalHostOf(env, home)
  const sameHost = finalHost === host || finalHost === `www.${host}` || `www.${finalHost}` === host
  add('final-domain', '최종 도메인 일치', sameHost ? 'pass' : 'fail',
    sameHost ? finalHost : `다른 위치(${finalHost})로 이동합니다. 리디렉션 설정을 확인해 주세요.`)

  // 2) 페이지 내용
  const html = home.text
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  add('title', 'title 존재', titleMatch ? 'pass' : 'fail', titleMatch ? titleMatch[1].trim().slice(0, 80) : 'title 태그가 없습니다.')

  const nameFound = expectedName && html.includes(expectedName)
  add('site-identity', `병원명 일치(${expectedName})`, nameFound ? 'pass' : 'fail',
    nameFound ? '페이지에서 병원명을 확인했습니다.' : '페이지에 병원명이 없습니다 — 다른 사이트가 표시되고 있을 수 있습니다. Pages 프로젝트의 SITE 환경변수를 확인해 주세요.')

  const canonicalMatch = html.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i)
  if (!canonicalMatch) {
    add('canonical', 'canonical 존재', 'fail', 'canonical 태그가 없습니다.')
  } else if (isPreview) {
    add('canonical', 'canonical 존재', 'pass', `Preview 배포 — canonical은 운영 도메인(${canonicalMatch[1]})을 가리키는 것이 정상입니다.`)
  } else {
    let canonicalHost = ''
    try { canonicalHost = new URL(canonicalMatch[1]).hostname.toLowerCase() } catch { canonicalHost = '' }
    const expect = (expectedCanonicalHost || host).toLowerCase()
    const match = canonicalHost === expect || canonicalHost === `www.${expect}` || `www.${canonicalHost}` === expect
    add('canonical', 'canonical 일치', match ? 'pass' : 'fail',
      match ? canonicalMatch[1] : `canonical(${canonicalMatch[1]})이 대상 도메인(${expect})과 다릅니다. 사이트 설정의 site.url을 확인해 주세요.`)
  }

  const hasSchema = /application\/ld\+json/i.test(html)
  add('schema', 'Schema(JSON-LD) 존재', hasSchema ? 'pass' : 'warning', hasSchema ? '정상' : '구조화 데이터가 없습니다.')

  const hasCta = /href\s*=\s*["']tel:/i.test(html) || /booking\.naver\.com|pf\.kakao\.com/i.test(html)
  add('cta', 'CTA 링크(전화·예약)', hasCta ? 'pass' : 'warning', hasCta ? '정상' : '전화·예약 링크가 보이지 않습니다.')

  const noindex = /<meta[^>]*name\s*=\s*["']robots["'][^>]*noindex/i.test(html)
  add('noindex', 'noindex 오설정 없음', noindex ? 'fail' : 'pass', noindex ? '홈페이지에 noindex가 설정되어 있습니다 — 검색 제외 상태!' : '정상')

  // 3) robots.txt / sitemap.xml
  const robots = await fetchText(env, host, '/robots.txt', timeoutMs)
  if (robots.ok && robots.status === 200) {
    const disallowAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*($|\n)/i.test(robots.text)
    add('robots', 'robots.txt', disallowAll ? 'fail' : 'pass', disallowAll ? '전체 차단(Disallow: /) 상태입니다 — 검색 노출 불가!' : '정상')
  } else {
    add('robots', 'robots.txt', 'warning', 'robots.txt를 확인하지 못했습니다.')
  }
  const sitemap = await fetchText(env, host, '/sitemap.xml', timeoutMs)
  const sitemapOk = sitemap.ok && sitemap.status === 200 && /<(urlset|sitemapindex)/i.test(sitemap.text)
  add('sitemap', 'sitemap.xml', sitemapOk ? 'pass' : 'warning', sitemapOk ? '정상' : 'sitemap을 확인하지 못했습니다. (재배포 직후라면 잠시 후 재검증)')

  const hasFail = checks.some((check) => check.status === 'fail')
  const hasWarning = checks.some((check) => check.status === 'warning')
  return { status: hasFail ? 'failed' : hasWarning ? 'partial_success' : 'success', checks, finalUrl: home.finalUrl }
}
