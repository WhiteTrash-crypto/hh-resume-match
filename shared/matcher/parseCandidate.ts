import { includesPhrase, normalizeText } from './normalize'
import { extractDomainIds } from './matchers/domain'
import { extractResponsibilityIds } from './matchers/responsibilities'
import { extractSkillIds } from './matchers/skills'
import {
  detectSeniority,
  extractYears,
  normalizeTitle,
  parseLanguageLevel,
} from './matchers/title'
import { loadTaxonomies } from './taxonomies/loader'
import type {
  CandidateProfile,
  EmploymentType,
  LanguageLevel,
} from './types'

function extractLanguages(text: string): Record<string, LanguageLevel> {
  const { languages } = loadTaxonomies()
  const out: Record<string, LanguageLevel> = {}
  const n = normalizeText(text)
  for (const [lang, aliases] of Object.entries(languages.aliases)) {
    for (const a of aliases) {
      const alias = normalizeText(a)
      if (!alias || !includesPhrase(n, a)) continue
      const idx = n.indexOf(alias)
      if (idx < 0) continue
      const before = n.slice(Math.max(0, idx - 12), idx)
      // Skip negations: "no Mandarin", "without Chinese"
      if (/\b(no|not|without|без|нет)\s*$/i.test(before)) continue
      const window = n.slice(Math.max(0, idx - 10), idx + alias.length + 30)
      out[lang] = parseLanguageLevel(window)
      if (out[lang] === 'unknown') {
        out[lang] = lang === 'russian' ? 'native' : 'b2'
      }
      break
    }
  }
  return out
}

function extractTotalYears(text: string): number | null {
  const y = extractYears(text)
  if (y.minimum != null) return y.minimum
  const m = normalizeText(text).match(/(\d+)\+?\s*years?\s+(?:of\s+)?(?:total\s+)?experience/)
  if (m) return Number(m[1])
  const m2 = normalizeText(text).match(/опыт(?:\s+работы)?\s*[—:\-]?\s*(\d+)/)
  if (m2) return Number(m2[1])
  return null
}

/**
 * Build structured candidate profile from resume PDF text + search keys.
 * Search keys win for target roles (§44 adapted).
 */
export function parseCandidate(
  resumeText: string,
  searchQueries: string[] = [],
): CandidateProfile {
  const raw = resumeText || ''
  const n = normalizeText(raw)

  const target_roles: string[] = []
  const acceptable_roles: string[] = []
  for (const q of searchQueries.filter(Boolean)) {
    const t = normalizeTitle(q)
    if (t.id) {
      if (!target_roles.includes(t.id)) target_roles.push(t.id)
    }
  }
  // From resume headline / first lines
  const head = raw.slice(0, 800)
  const fromCv = normalizeTitle(head)
  if (fromCv.id && !target_roles.includes(fromCv.id)) {
    acceptable_roles.push(fromCv.id)
  }
  // Related roles as acceptable
  const tax = loadTaxonomies()
  for (const role of [...target_roles]) {
    const related = tax.titles[role]?.related || {}
    for (const [rid, w] of Object.entries(related)) {
      if (w >= 0.3 && !target_roles.includes(rid) && !acceptable_roles.includes(rid)) {
        acceptable_roles.push(rid)
      }
    }
  }

  const remoteOnly =
    /remote\s+only|только\s+удал|удал[её]нк\w*\s+only|no\s+office|без\s+офиса/i.test(raw)
  const officeOnly = /только\s+офис|office\s+only|не\s+рассматриваю\s+удал/i.test(raw)
  const remote_allowed = !officeOnly

  const management = {
    people_management:
      /manage(d|s)?\s+(a\s+)?team|direct reports|руководил\s+командой|управление\s+командой|people management/i.test(
        raw,
      ),
    max_team_size: (() => {
      const m = raw.match(/team of\s*(\d+)|команд[аыуе]\s*(?:из\s*)?(\d+)/i)
      return m ? Number(m[1] || m[2]) : null
    })(),
    hiring: /hir(e|ing)|на[её]м|recruit/i.test(raw),
    budget_ownership: /budget|бюджет/i.test(raw),
    pnl: /p\s*&\s*l|p&l|\bpnl\b/i.test(raw),
    mentoring: /mentor|наставник/i.test(raw),
  }

  const employment_types: EmploymentType[] = ['full_time', 'contract']
  if (/freelance|фриланс/i.test(raw)) employment_types.push('freelance')

  const years = extractTotalYears(raw)
  let seniority = detectSeniority(head)
  if (seniority === 'unknown') seniority = detectSeniority(raw)
  if (seniority === 'unknown' && years != null) {
    if (years >= 10) seniority = 'lead'
    else if (years >= 6) seniority = 'senior'
    else if (years >= 4) seniority = 'middle_plus'
    else if (years >= 2) seniority = 'middle'
    else seniority = 'junior'
  }

  return {
    target_roles,
    acceptable_roles,
    seniority,
    years_total_experience: years,
    years_relevant_experience: years,
    domains: extractDomainIds(raw),
    skills: extractSkillIds(raw),
    responsibilities: extractResponsibilityIds(raw),
    management,
    languages: extractLanguages(raw),
    locations: [],
    remote_allowed,
    office_allowed_locations: remoteOnly ? [] : ['any'],
    work_authorization: [],
    min_salary: null,
    employment_types,
    education: (() => {
      const eds: string[] = []
      if (/ph\.?d|кандидат наук/i.test(n)) eds.push('phd')
      if (/\bmba\b/i.test(n)) eds.push('mba')
      if (/master|магистр/i.test(n)) eds.push('master')
      if (/bachelor|бакалавр|высшее/i.test(n)) eds.push('bachelor')
      return eds
    })(),
    certifications: extractSkillIds(raw).filter((id) =>
      ['aws', 'azure', 'gcp'].includes(id),
    ),
    raw_text: n,
    search_queries: searchQueries.filter(Boolean),
  }
}
