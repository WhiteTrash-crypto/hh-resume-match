import { parseCandidate } from './parseCandidate'
import { parseVacancy } from './parseVacancy'
import { scoreMatch } from './scoring'
import type { CandidateProfile, MatchResult } from './types'
import type { Vacancy } from '../types'

export type { CandidateProfile, MatchResult, StructuredVacancy, DimensionScores } from './types'
export { parseCandidate } from './parseCandidate'
export { parseVacancy } from './parseVacancy'
export { scoreMatch } from './scoring'
export { loadTaxonomies } from './taxonomies/loader'

/**
 * Full deterministic match: structured candidate + HH vacancy → MatchResult.
 */
export function matchVacancy(
  candidate: CandidateProfile,
  vacancy: Vacancy,
  opts: { debug?: boolean } = {},
): MatchResult {
  const structured = parseVacancy(vacancy)
  return scoreMatch(candidate, structured, opts)
}

/**
 * Convenience: raw resume text + search keys + vacancy.
 */
export function matchResumeToVacancy(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[] = [],
  opts: { debug?: boolean } = {},
): MatchResult {
  const candidate = parseCandidate(resumeText, searchQueries)
  return matchVacancy(candidate, vacancy, opts)
}
