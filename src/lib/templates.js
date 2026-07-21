// ============================================================
// Template Registry (Phase 10)
//
// templates/<templateId>/template.json 을 읽어 업종별 템플릿 정의를 제공합니다.
// 지금은 "정의(Registry)"만 존재하며, 전용 UI 렌더러는 향후 Phase에서 추가됩니다.
//
// 규칙:
// - template 필드가 없는 사이트는 자동으로 DEFAULT_TEMPLATE('medical') 사용
//   → 기존 사이트(aiseolab, andrology)는 아무것도 바뀌지 않습니다.
// - templates/hospital 은 create-site용 "사이트 스캐폴드"로 별개 용도이며,
//   template.json이 없으므로 Registry가 자동으로 무시합니다.
// - templateId는 ^[a-z0-9]+(-[a-z0-9]+)*$ 만 허용 (path traversal 방지)
// - 깨진 template.json·잘못된 구조는 어느 파일인지 명시한 오류로 빌드 중단
//
// 빌드 시점의 Node에서 실행됩니다 (load-hospital.js와 동일한 방식).
// ============================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_TEMPLATE = 'medical'
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidTemplateId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

// template.json 1개 로드 + 구조 검증
function loadTemplateFile(templatesDir, id) {
  const filePath = join(templatesDir, id, 'template.json')
  if (!existsSync(filePath)) return null
  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    throw new Error(`[템플릿 오류] templates/${id}/template.json 이 올바른 JSON이 아닙니다: ${e.message}`)
  }
  if (parsed.id !== id) {
    throw new Error(`[템플릿 오류] templates/${id}/template.json 의 id("${parsed.id}")가 폴더명과 일치하지 않습니다.`)
  }
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
    throw new Error(`[템플릿 오류] templates/${id}/template.json 에 name이 없습니다.`)
  }
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error(`[템플릿 오류] templates/${id}/template.json 의 sections는 비어 있지 않은 배열이어야 합니다.`)
  }
  return parsed
}

// 등록된 템플릿 전체 목록 (폴더명 오름차순 — 결정적)
// template.json이 없는 폴더(예: templates/hospital 스캐폴드)는 무시합니다.
export function getTemplates({ rootDir = process.cwd() } = {}) {
  const templatesDir = join(rootDir, 'templates')
  if (!existsSync(templatesDir)) return []
  return readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isValidTemplateId(entry.name))
    .map((entry) => loadTemplateFile(templatesDir, entry.name))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function templateExists(id, { rootDir = process.cwd() } = {}) {
  if (!isValidTemplateId(id)) return false
  return existsSync(join(rootDir, 'templates', id, 'template.json'))
}

// 템플릿 1개 조회 — 등록되지 않은 id는 명확한 오류 (조용한 대체 없음)
export function getTemplate(id, { rootDir = process.cwd() } = {}) {
  if (!isValidTemplateId(id)) {
    throw new Error(`[템플릿 오류] 올바르지 않은 template id입니다: "${String(id)}"`)
  }
  const template = loadTemplateFile(join(rootDir, 'templates'), id)
  if (!template) {
    const available = getTemplates({ rootDir }).map((t) => t.id).join(', ')
    throw new Error(`[템플릿 오류] 등록되지 않은 template입니다: "${id}" — 사용 가능: ${available}`)
  }
  return template
}

// 사이트 데이터의 template 필드 → 템플릿 id (없으면 기본값 medical)
export function resolveTemplateId(rawTemplate) {
  const value = typeof rawTemplate === 'string' ? rawTemplate.trim() : ''
  return value === '' ? DEFAULT_TEMPLATE : value
}
