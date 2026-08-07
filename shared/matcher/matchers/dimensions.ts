import { loadTaxonomies } from '../taxonomies/loader'
import type { CandidateProfile, SeniorityLevel, StructuredVacancy } from '../types'
import { languageRank } from './title'

export function scoreSeniority(
  candidate: SeniorityLevel,
  vacancy: SeniorityLevel,
): number {
  const matrix = loadTaxonomies().scoring.seniority_matrix
  const row = matrix[candidate] || matrix.unknown
  const key = vacancy === 'unknown' ? 'middle' : vacancy
  // Map director/vp/c_level onto head bucket
  const vacKey =
    key === 'director' || key === 'vp' || key === 'c_level' || key === 'intern'
      ? key === 'intern'
        ? 'junior'
        : 'head'
      : key
  const candKey =
    candidate === 'director' || candidate === 'vp' || candidate === 'c_level'
      ? 'head'
      : candidate === 'intern'
        ? 'junior'
        : candidate
  const r = matrix[candKey] || row
  return r[vacKey] ?? r.middle ?? 50
}

export function scoreExperience(
  candidateYears: number | null,
  requiredYears: number | null,
): number {
  const cfg = loadTaxonomies().scoring.experience_scoring
  if (requiredYears == null) return cfg.unknown
  if (candidateYears == null) return cfg.unknown
  if (candidateYears >= requiredYears) return cfg.exact_or_above
  if (candidateYears === requiredYears - 1) return cfg.minus_1
  if (candidateYears === requiredYears - 2) return cfg.minus_2
  if (candidateYears >= requiredYears * 0.5) return cfg.half
  return cfg.below_half
}

export function scoreManagement(
  candidate: CandidateProfile,
  vacancy: StructuredVacancy,
): number {
  const req = vacancy.management_requirements
  const needs =
    Number(req.people_management) +
    Number(req.hiring) +
    Number(req.pnl) +
    Number(req.mentoring)
  if (!needs) return 70
  let hits = 0
  if (req.people_management && candidate.management.people_management) hits += 1
  if (req.hiring && candidate.management.hiring) hits += 1
  if (req.pnl && candidate.management.pnl) hits += 1
  if (req.mentoring && candidate.management.mentoring) hits += 1
  return Math.round((hits / needs) * 100)
}

export function scoreEducation(
  candidate: CandidateProfile,
  vacancy: StructuredVacancy,
): number {
  if (!vacancy.education.length && !vacancy.certifications.length) return 50
  let score = 50
  if (vacancy.education.length) {
    const hit = vacancy.education.some((e) =>
      candidate.education.some((c) => c === e || candidate.raw_text.includes(e)),
    )
    score = hit ? 90 : 40
  }
  for (const cert of vacancy.certifications) {
    const has = candidate.certifications.includes(cert.id)
    if (cert.requirement_type === 'required' && !has) score = Math.min(score, 30)
    if (has) score = Math.max(score, 80)
  }
  return score
}

export function candidateMeetsLanguage(
  candidate: CandidateProfile,
  language: string,
  requiredLevel: import('../types').LanguageLevel,
): boolean {
  const level = candidate.languages[language]
  if (!level || level === 'unknown') return false
  return languageRank(level) >= languageRank(requiredLevel)
}
