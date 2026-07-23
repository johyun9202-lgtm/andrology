// ============================================================
// DNS 기대값 생성·레코드 비교 — 순수 함수 (Phase 14C)
//
// 연결 대상(Pages 호스트)은 하드코딩하지 않고 env에서 가져옵니다:
//   DOMAIN_PAGES_HOST (직접 지정) 또는 CLOUDFLARE_PAGES_PROJECT → <project>.pages.dev
// 미설정 시 자리표시자를 안내하고, 비교는 "수동 확인 필요"로 처리합니다.
// ============================================================

// env → Pages 연결 대상 호스트 ('' = 미설정)
export function resolvePagesHost(env) {
  const direct = typeof env?.DOMAIN_PAGES_HOST === 'string' ? env.DOMAIN_PAGES_HOST.trim().toLowerCase() : ''
  if (direct !== '') return direct.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const project = typeof env?.CLOUDFLARE_PAGES_PROJECT === 'string' ? env.CLOUDFLARE_PAGES_PROJECT.trim().toLowerCase() : ''
  return project !== '' ? `${project}.pages.dev` : ''
}

const PROXY_RECOMMENDED = 'Proxied(주황 구름) 권장'
const TTL_RECOMMENDED = 'Auto'

// 운영방식·도메인 유형별 필요한 DNS 레코드 안내 생성.
// primary=true 레코드가 검증 대상이며, 나머지는 권장 안내입니다.
// pagesHost가 비어 있으면 placeholder=true (검증 시 수동 확인 처리)
export function buildExpectedRecords({ domain, domainType, operationMode, pagesHost }) {
  if (!domain) return []
  const target = pagesHost || '<Pages프로젝트>.pages.dev'
  const placeholder = !pagesHost
  const records = []
  const base = { proxy: PROXY_RECOMMENDED, ttl: TTL_RECOMMENDED, placeholder }

  if (domainType === 'subdomain') {
    const label = domain.split('.')[0]
    records.push({
      ...base, primary: true, type: 'CNAME', name: label, target,
      description: `서브도메인(${domain})을 Pages로 연결합니다. Cloudflare Dashboard → Pages → Custom domains에 ${domain} 추가 후 이 레코드가 자동/수동 생성됩니다.`,
    })
  } else if (domainType === 'www') {
    records.push({
      ...base, primary: true, type: 'CNAME', name: 'www', target,
      description: `www 도메인을 Pages로 연결합니다. 루트(${domain.replace(/^www\./, '')})는 www로 리디렉션 설정을 권장합니다.`,
    })
  } else {
    // apex
    records.push({
      ...base, primary: true, type: 'CNAME', name: '@', target,
      description: `루트 도메인(${domain})을 Pages로 연결합니다. Cloudflare DNS는 루트에서도 CNAME 사용 가능(CNAME Flattening). 다른 DNS 업체를 쓰면 네임서버를 Cloudflare로 이전하거나 ALIAS/ANAME을 사용해야 합니다.`,
    })
    records.push({
      ...base, primary: false, type: 'CNAME', name: 'www', target,
      description: `www.${domain} 접속도 받으려면 함께 등록하고 Pages Custom domains에 www.${domain}도 추가하세요. (선택 권장)`,
    })
  }

  if (operationMode === 'replace') {
    records.push({
      ...base, primary: false, type: 'INFO', name: '(변경 전 기록)', target: '기존 A/CNAME 레코드 값 백업',
      description: '교체 모드 필수: DNS 변경 전 기존 레코드(Type/Name/Value)를 기록해 두세요. 문제 발생 시 이 값으로 되돌리는 것이 롤백 절차입니다.',
    })
  }
  return records
}

// 실제 조회 결과와 기대값 비교.
// answers: [{ type: 'CNAME'|'A'|'AAAA'|..., value }] (resolver 결과, 소문자·trailing dot 제거는 여기서 수행)
// lookupStatus: 'ok' | 'nxdomain' | 'error'
// 반환: { status: 'ok'|'pending'|'mismatch'|'manual'|'error', detail }
export function compareDnsRecords(expectedRecords, answers, lookupStatus) {
  const primary = (expectedRecords ?? []).find((record) => record.primary)
  if (!primary) return { status: 'manual', detail: '기대 레코드가 없습니다. 도메인을 다시 저장해 주세요.' }
  if (lookupStatus === 'error') return { status: 'error', detail: 'DNS 조회에 실패했습니다. 잠시 후 다시 검증해 주세요.' }
  if (primary.placeholder) {
    return { status: 'manual', detail: 'Pages 연결 대상(CLOUDFLARE_PAGES_PROJECT 또는 DOMAIN_PAGES_HOST)이 설정되지 않아 자동 비교할 수 없습니다. Cloudflare Dashboard에서 직접 확인해 주세요.' }
  }
  const clean = (value) => String(value ?? '').toLowerCase().replace(/\.$/, '').replace(/^"|"$/g, '')
  const list = (answers ?? []).map((answer) => ({ type: String(answer.type ?? '').toUpperCase(), value: clean(answer.value) }))
  if (lookupStatus === 'nxdomain' || list.length === 0) {
    return { status: 'pending', detail: '아직 DNS 레코드가 조회되지 않습니다. 레코드 등록 직후라면 전파까지 수 분~수 시간 걸릴 수 있습니다.' }
  }
  const cnames = list.filter((answer) => answer.type === 'CNAME')
  if (cnames.some((answer) => answer.value === clean(primary.target))) {
    return { status: 'ok', detail: `CNAME → ${primary.target} 확인` }
  }
  if (cnames.length > 0) {
    return { status: 'mismatch', detail: `CNAME이 다른 대상(${cnames[0].value})을 가리키고 있습니다. 기대값: ${primary.target}` }
  }
  const ips = list.filter((answer) => answer.type === 'A' || answer.type === 'AAAA')
  if (ips.length > 0) {
    return { status: 'manual', detail: 'A/AAAA 레코드만 조회됩니다. Cloudflare 프록시(CNAME Flattening) 상태일 수 있으니 HTTPS 응답 검사와 Cloudflare Dashboard에서 연결을 확인해 주세요.' }
  }
  return { status: 'pending', detail: '기대한 유형의 레코드가 아직 조회되지 않습니다.' }
}
