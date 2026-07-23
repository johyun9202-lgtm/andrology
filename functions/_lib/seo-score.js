// ============================================================
// SEO Health Score — 실제 점검 결과 기반 가중 점수 (Phase 16, 순수 함수)
//
// 총점 100 = Technical 30 + Content 25 + Entity 20 + Conversion 15 + Operations 10
// 단순 발견 개수가 아니라 규칙별 가중치(weight)로 감점하며,
// 치명 항목은 전체 점수에 상한을 둡니다. 실측 없는 값은 계산에 넣지 않습니다.
// ============================================================

export const CATEGORY_WEIGHTS = { technical: 30, content: 25, entity: 20, conversion: 15, operations: 10 }

// 이 규칙이 fail이면 전체 점수 상한 20 (사이트가 사실상 기능하지 않는 상태)
export const CATASTROPHIC_RULES = ['home-response', 'wrong-site', 'noindex', 'robots-blocked', 'no-cta']

// ruleResults: [{ ruleKey, category, weight, status: 'pass'|'warning'|'fail'|'skipped' }]
// 반환: { overall, grade, categories: {technical: {score,max}, ...} }
export function computeSeoScore(ruleResults) {
  const categories = {}
  for (const [category, max] of Object.entries(CATEGORY_WEIGHTS)) {
    categories[category] = { score: max, max }
  }
  let catastrophic = false
  for (const result of ruleResults ?? []) {
    const bucket = categories[result.category]
    if (!bucket || result.status === 'pass' || result.status === 'skipped') continue
    const deduction = result.status === 'fail' ? (result.weight ?? 3) : (result.weight ?? 3) / 2
    bucket.score = Math.max(0, bucket.score - deduction)
    if (result.status === 'fail' && CATASTROPHIC_RULES.includes(result.ruleKey)) catastrophic = true
  }
  for (const bucket of Object.values(categories)) bucket.score = Math.round(bucket.score)
  let overall = Object.values(categories).reduce((sum, bucket) => sum + bucket.score, 0)
  if (catastrophic) overall = Math.min(overall, 20)
  return { overall, grade: gradeOf(overall), categories }
}

export function gradeOf(score) {
  if (score >= 90) return 'healthy'
  if (score >= 75) return 'good'
  if (score >= 60) return 'warning'
  return 'critical'
}
