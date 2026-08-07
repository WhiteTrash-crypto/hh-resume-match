import type { SkillMatch } from './matchers/skills'
import type { CandidateProfile, DimensionScores, StructuredVacancy } from './types'

export function computeConfidence(vacancy: StructuredVacancy): number {
  let score = 40
  if (vacancy.title_normalized) score += 15
  if (vacancy.sections.requirements) score += 15
  if (vacancy.skills.length >= 3) score += 10
  else if (vacancy.skills.length >= 1) score += 5
  if (vacancy.responsibilities.length >= 3) score += 10
  else if (vacancy.responsibilities.length >= 1) score += 5
  if (vacancy.seniority !== 'unknown') score += 5
  if (vacancy.work_mode !== 'unknown') score += 5
  if ((vacancy.raw_text || '').length > 400) score += 5
  return Math.max(0, Math.min(100, score))
}

export function buildExplanations(input: {
  title: { score: number; matchType: string; matchedRole: string | null }
  dimensions: DimensionScores
  skills: SkillMatch
  domain: { score: number; matched: Array<{ requirement: string; candidate_match?: string }> }
  vacancy: StructuredVacancy
  candidate: CandidateProfile
  final: number
}): string[] {
  const reasons: string[] = []
  const { title, dimensions, skills, domain, vacancy, candidate } = input

  if (title.score >= 90) {
    reasons.push(
      `Strong title match: ${title.matchedRole || candidate.target_roles[0] || 'role'} ↔ ${vacancy.title_raw}`,
    )
  } else if (title.score >= 60) {
    reasons.push(
      `Related title match (${title.matchType}): ${title.matchedRole || 'query'} ↔ ${vacancy.title_raw}`,
    )
  } else if (title.score <= 20) {
    reasons.push(`Weak/unrelated title: ${vacancy.title_raw}`)
  }

  if (domain.score >= 80 && domain.matched[0]) {
    reasons.push(
      `Domain match: candidate ${domain.matched[0].candidate_match}; vacancy ${domain.matched[0].requirement}`,
    )
  }

  if (dimensions.responsibilities >= 80) {
    reasons.push('Most responsibilities matched')
  } else if (dimensions.responsibilities < 40 && vacancy.responsibilities.length) {
    reasons.push('Low responsibility overlap')
  }

  for (const m of skills.matched.slice(0, 3)) {
    if ((m.credit || 0) < 1 && m.match_type && m.match_type !== 'exact') {
      reasons.push(
        `Partial skill match: vacancy ${m.requirement}; candidate ${m.candidate_match} (${m.match_type})`,
      )
    }
  }

  for (const miss of skills.missing_required.slice(0, 3)) {
    reasons.push(`Missing required skill: ${miss.requirement}`)
  }

  if (dimensions.seniority >= 85) {
    reasons.push(
      `Seniority compatible: candidate ${candidate.seniority}; vacancy ${vacancy.seniority}`,
    )
  } else if (dimensions.seniority < 40) {
    reasons.push(
      `Seniority mismatch: candidate ${candidate.seniority}; vacancy ${vacancy.seniority}`,
    )
  }

  if (dimensions.management < 40 && vacancy.management_requirements.people_management) {
    reasons.push('Management requirements not met')
  }

  if (!reasons.length) {
    reasons.push(`Match score ${input.final}/100`)
  }
  return reasons
}
