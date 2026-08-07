import type { Vacancy } from '../types'
import { includesPhrase, normalizeText } from './normalize'
import { extractDomainIds } from './matchers/domain'
import { extractResponsibilityIds } from './matchers/responsibilities'
import { extractSkillsFromVacancyText } from './matchers/skills'
import {
  detectSeniority,
  extractYears,
  normalizeTitle,
  parseLanguageLevel,
} from './matchers/title'
import { classifyRequirement, detectSections, splitSentences } from './sections'
import { loadTaxonomies } from './taxonomies/loader'
import type {
  EmploymentType,
  StructuredVacancy,
  VacancyLanguage,
  VacancySkill,
} from './types'

function parseEmployment(text: string): EmploymentType {
  const n = normalizeText(text)
  if (/part[- ]?time|частичн/.test(n)) return 'part_time'
  if (/contract|контракт|гпх/.test(n)) return 'contract'
  if (/freelance|фриланс/.test(n)) return 'freelance'
  if (/intern|стаж/.test(n)) return 'internship'
  if (/temporary|временн/.test(n)) return 'temporary'
  if (/full[- ]?time|полный\s+день|полная\s+занятость/.test(n)) return 'full_time'
  return 'unknown'
}

function parseLocation(vacancy: Vacancy, text: string): StructuredVacancy['location'] {
  const blob = `${vacancy.location} ${vacancy.schedule} ${text}`
  const n = normalizeText(blob)
  const remote =
    /remote|удал|work from home|worldwide remote|remote worldwide/i.test(blob)
  const hybrid = /hybrid|гибрид/i.test(blob)
  const office =
    !remote && !hybrid && (/офис|office|on-?site|в офисе/i.test(blob) || Boolean(vacancy.location))
  const remote_scope: string[] = []
  if (/remote\s+(in\s+)?eu|europe|ес\b|европ/i.test(blob)) remote_scope.push('europe')
  if (/remote\s+worldwide|worldwide|anywhere/i.test(blob)) remote_scope.push('worldwide')
  if (/us only|united states only|usa only/i.test(blob)) remote_scope.push('us')
  const countries: string[] = []
  if (/germany|берлин|berlin|deutschland|германи/i.test(blob)) countries.push('germany')
  if (/russia|москва|санкт|росси/i.test(blob)) countries.push('russia')
  if (/uk\b|united kingdom|london|великобритан/i.test(blob)) countries.push('uk')
  return {
    countries,
    cities: [],
    remote,
    remote_scope,
    hybrid,
    office: office && !remote,
    relocation: /relocati|релокац/i.test(n),
  }
}

function parseSalary(vacancy: Vacancy): StructuredVacancy['salary'] {
  const s = vacancy.salary || ''
  const nums = [...s.matchAll(/(\d[\d\s]*)/g)].map((m) =>
    Number(m[1].replace(/\s/g, '')),
  )
  const currency = /usd|\$/i.test(s)
    ? 'USD'
    : /eur|€/i.test(s)
      ? 'EUR'
      : /rub|₽|руб/i.test(s)
        ? 'RUB'
        : null
  return {
    min: nums[0] ?? null,
    max: nums[1] ?? nums[0] ?? null,
    currency,
    period: /year|год|год/i.test(s) ? 'year' : /month|мес/i.test(s) ? 'month' : null,
    explicit: nums.length > 0,
  }
}

function extractLanguages(text: string, sections: Record<string, string>): VacancyLanguage[] {
  const { languages } = loadTaxonomies()
  const out: VacancyLanguage[] = []
  const seen = new Set<string>()
  // Prefer line-level splits so "English preferred" does not pollute Mandarin.
  const pool = `${sections.languages || ''}\n${sections.requirements || ''}\n${text}`
  const lines = pool
    .split(/\n+/)
    .flatMap((line) => splitSentences(line))
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
  for (const [lang, aliases] of Object.entries(languages.aliases)) {
    const canonical = lang === 'mandarin' ? 'chinese' : lang
    if (seen.has(canonical)) continue
    for (const sentence of lines) {
      if (!aliases.some((a) => includesPhrase(sentence, a))) continue
      const before = normalizeText(sentence).split(normalizeText(aliases[0]))[0] || ''
      if (/\b(no|not|without|без)\b/i.test(before) && before.length < 20) continue
      const requirement_type = classifyRequirement(sentence, 'languages')
      const level = parseLanguageLevel(sentence)
      out.push({
        language: canonical,
        level: level === 'unknown' ? 'fluent' : level,
        requirement_type,
        evidence: sentence.slice(0, 160),
      })
      seen.add(canonical)
      break
    }
  }
  return out
}

function refineSkillTypes(
  skills: VacancySkill[],
  sections: Record<string, string>,
): VacancySkill[] {
  return skills.map((s) => {
    const reqText = sections.requirements || ''
    const niceText = sections.nice_to_have || ''
    if (niceText && includesPhrase(niceText, s.evidence || s.id)) {
      return { ...s, requirement_type: 'preferred' as const }
    }
    const full = normalizeText(sections.full || `${reqText}\n${niceText}`)
    const needle = normalizeText(s.evidence || s.id)
    const idx = full.indexOf(needle)
    if (idx >= 0) {
      const window = full.slice(Math.max(0, idx - 40), idx + needle.length + 80)
      const t = classifyRequirement(window, s.source_section)
      if (t !== 'unknown') return { ...s, requirement_type: t }
    }
    if (reqText && includesPhrase(reqText, s.evidence || s.id) && s.requirement_type === 'unknown') {
      return { ...s, requirement_type: 'required' as const }
    }
    return s
  })
}

export function parseVacancy(vacancy: Vacancy): StructuredVacancy {
  const content = vacancy.content || vacancy.snippet || ''
  const fullText = `${vacancy.title}\n${vacancy.employer}\n${vacancy.experience}\n${vacancy.schedule}\n${content}`
  const sections = detectSections(fullText)
  const titleInfo = normalizeTitle(vacancy.title)
  const seniority = detectSeniority(vacancy.title)
  const yearsFromExp = extractYears(vacancy.experience || '')
  const yearsFromBody = extractYears(sections.requirements || content)
  const experience = {
    minimum_years_total: yearsFromExp.minimum ?? yearsFromBody.minimum,
    minimum_years_role: yearsFromBody.minimum ?? yearsFromExp.minimum,
    strict: yearsFromExp.strict || yearsFromBody.strict,
    requirement_type: classifyRequirement(
      `${vacancy.experience} ${sections.requirements || ''}`,
      'requirements',
    ),
  }

  const skillsRaw = [
    ...extractSkillsFromVacancyText(sections.requirements || '', 'requirements', classifyRequirement),
    ...extractSkillsFromVacancyText(sections.nice_to_have || '', 'nice_to_have', classifyRequirement),
    ...extractSkillsFromVacancyText(sections.full || content, undefined, classifyRequirement),
  ]
  const skillMap = new Map<string, VacancySkill>()
  for (const s of skillsRaw) {
    const prev = skillMap.get(s.id)
    if (!prev) skillMap.set(s.id, s)
    else if (s.requirement_type === 'required') skillMap.set(s.id, s)
    else if (prev.requirement_type === 'unknown' && s.requirement_type !== 'unknown') {
      skillMap.set(s.id, s)
    }
  }
  const skills = refineSkillTypes([...skillMap.values()], sections)

  const location = parseLocation(vacancy, fullText)
  let work_mode = 'unknown'
  if (location.remote) work_mode = 'remote'
  else if (location.hybrid) work_mode = 'hybrid'
  else if (location.office) work_mode = 'office'

  const mgmtText = `${sections.responsibilities || ''} ${content}`
  const management_requirements = {
    people_management:
      /manage\s+(a\s+)?team|direct reports|team of\s*\d+|руковод\w*\s+команд|управление\s+командой/i.test(
        mgmtText,
      ),
    hiring: /hire\s+and|hiring|наним|recruit\s+and\s+develop/i.test(mgmtText),
    pnl: /p\s*&\s*l|p&l|\bpnl\b|own p/i.test(mgmtText),
    mentoring: /mentor|develop\s+team|настав/i.test(mgmtText),
  }

  return {
    id: vacancy.vacancyId,
    title_raw: vacancy.title,
    title_normalized: titleInfo.id,
    seniority: seniority === 'unknown' ? detectSeniority(fullText) : seniority,
    company: vacancy.employer,
    location,
    salary: parseSalary(vacancy),
    employment_type: parseEmployment(`${vacancy.schedule} ${content}`),
    experience,
    languages: extractLanguages(fullText, sections),
    skills,
    responsibilities: extractResponsibilityIds(
      `${sections.responsibilities || ''} ${sections.requirements || ''} ${content}`,
    ),
    domains: extractDomainIds(fullText),
    management_requirements,
    education: [],
    certifications: [],
    sections,
    raw_text: normalizeText(fullText),
    work_mode,
  }
}
