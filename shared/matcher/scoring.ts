import { applyMatcherHardFilters } from './hardFilters'
import {
  scoreEducation,
  scoreExperience,
  scoreManagement,
  scoreSeniority,
} from './matchers/dimensions'
import { scoreDomains } from './matchers/domain'
import { scoreResponsibilities } from './matchers/responsibilities'
import { scoreSkills } from './matchers/skills'
import { scoreTitleMatch } from './matchers/title'
import { loadTaxonomies } from './taxonomies/loader'
import type {
  CandidateProfile,
  DimensionScores,
  MatchResult,
  ScoreBand,
  StructuredVacancy,
} from './types'
import { buildExplanations, computeConfidence } from './explain'

function bandFor(score: number): ScoreBand {
  const b = loadTaxonomies().scoring.score_bands
  if (score >= b.excellent) return 'excellent'
  if (score >= b.good) return 'good'
  if (score >= b.possible) return 'possible'
  if (score >= b.weak) return 'weak'
  return 'poor'
}

export function scoreMatch(
  candidate: CandidateProfile,
  vacancy: StructuredVacancy,
  opts: { debug?: boolean } = {},
): MatchResult {
  const tax = loadTaxonomies()
  const trace: Array<{ rule: string; [k: string]: unknown }> = []

  const hard = applyMatcherHardFilters(candidate, vacancy)
  if (hard.rejected) {
    const confidence = computeConfidence(vacancy)
    return {
      vacancy_id: vacancy.id,
      rejected: true,
      score: 0,
      band: 'poor',
      confidence,
      dimensions: {
        role: 0,
        responsibilities: 0,
        skills: 0,
        domain: 0,
        seniority: 0,
        experience: 0,
        management: 0,
        education_certifications: 0,
      },
      matched: [],
      missing_required: [],
      missing_preferred: [],
      hard_filter_reasons: hard.reasons,
      reasons: hard.reasons.map(
        (r) => `Hard reject: ${r.rule} — need ${r.requirement}, candidate ${r.candidate}`,
      ),
      work_mode: vacancy.work_mode,
      debug: opts.debug ? { rule_trace: hard.reasons.map((r) => ({ rule: r.rule, ...r })) } : undefined,
    }
  }

  const roles = [...candidate.target_roles, ...candidate.acceptable_roles]
  // If no taxonomy roles, fall back to search query strings as soft role signal
  const title = scoreTitleMatch(roles, vacancy.title_normalized, vacancy.title_raw)
  if (!roles.length && candidate.search_queries.length) {
    // Token overlap fallback between queries and title
    const q = candidate.search_queries.join(' ').toLowerCase()
    const t = vacancy.title_raw.toLowerCase()
    const qTokens = q.split(/\s+/).filter((w) => w.length > 2)
    const hits = qTokens.filter((tok) => t.includes(tok)).length
    title.score = qTokens.length
      ? Math.round((hits / qTokens.length) * 85)
      : 40
    title.matchType = 'query_token'
  }
  trace.push({
    rule: 'title',
    score: title.score,
    matchType: title.matchType,
    matchedRole: title.matchedRole,
    vacancyTitle: vacancy.title_normalized,
  })

  const skills = scoreSkills(candidate.skills, vacancy.skills, candidate.raw_text)
  trace.push({ rule: 'skills', score: skills.score, penalty: skills.penalty })

  const resp = scoreResponsibilities(
    candidate.responsibilities,
    vacancy.responsibilities,
    candidate.raw_text,
    candidate.skills,
  )
  const domain = scoreDomains(candidate.domains, vacancy.domains, candidate.raw_text)
  const seniority = scoreSeniority(candidate.seniority, vacancy.seniority)
  const experience = scoreExperience(
    candidate.years_relevant_experience ?? candidate.years_total_experience,
    vacancy.experience.minimum_years_role ?? vacancy.experience.minimum_years_total,
  )
  const management = scoreManagement(candidate, vacancy)
  const education = scoreEducation(candidate, vacancy)

  const dimensions: DimensionScores = {
    role: title.score,
    responsibilities: resp.score,
    skills: skills.score,
    domain: domain.score,
    seniority,
    experience,
    management,
    education_certifications: education,
  }

  const w = tax.scoring.weights
  let final =
    dimensions.role * w.role +
    dimensions.responsibilities * w.responsibilities +
    dimensions.skills * w.skills +
    dimensions.domain * w.domain +
    dimensions.seniority * w.seniority +
    dimensions.experience * w.experience +
    dimensions.management * w.management +
    dimensions.education_certifications * w.education_certifications

  final = Math.max(0, Math.min(100, Math.round(final - skills.penalty)))

  // Hard cap when role is clearly unrelated
  if (title.score <= 12) final = Math.min(final, 35)
  else if (title.score < 30) final = Math.min(final, 50)

  const matched = [...skills.matched, ...resp.matched, ...domain.matched]
  if (title.matchedRole) {
    matched.unshift({
      type: 'role',
      requirement: vacancy.title_normalized || vacancy.title_raw,
      candidate_match: title.matchedRole,
      match_type: title.matchType,
      credit: title.score / 100,
    })
  }

  const confidence = computeConfidence(vacancy)
  const reasons = buildExplanations({
    title,
    dimensions,
    skills,
    domain,
    vacancy,
    candidate,
    final,
  })

  return {
    vacancy_id: vacancy.id,
    rejected: false,
    score: final,
    band: bandFor(final),
    confidence,
    dimensions,
    matched,
    missing_required: skills.missing_required,
    missing_preferred: skills.missing_preferred,
    hard_filter_reasons: [],
    reasons,
    work_mode: vacancy.work_mode,
    debug: opts.debug ? { rule_trace: trace } : undefined,
  }
}
