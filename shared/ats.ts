import { matchVacancy, parseCandidate } from './matcher'
import type { AtsResult, Vacancy } from './types'

/**
 * Rule-based ATS (deterministic, no LLM).
 * Maps MatchResult → AtsResult for Google Sheet compatibility.
 */

function toAts(result: import('./matcher').MatchResult, vacancy: Vacancy): AtsResult {
  let domainTier: 'A' | 'B' | 'C' = 'C'
  if (result.band === 'excellent' || result.band === 'good') domainTier = 'A'
  else if (result.band === 'possible') domainTier = 'B'

  const flags: string[] = []
  if (result.rejected) {
    for (const r of result.hard_filter_reasons) flags.push(r.rule)
  }
  if (result.dimensions.role <= 12) flags.push('wrong_role')
  for (const m of result.missing_required.slice(0, 5)) {
    flags.push(`missing:${m.requirement}`)
  }

  const dim = result.dimensions
  const dimSummary = `role ${dim.role}; skills ${dim.skills}; resp ${dim.responsibilities}; domain ${dim.domain}; sen ${dim.seniority}; exp ${dim.experience}`
  const reason = result.rejected
    ? result.reasons.join(' | ')
    : `${result.reasons.join(' | ')} [${dimSummary}; conf ${result.confidence}]`

  return {
    vacancyId: vacancy.vacancyId,
    score: result.rejected ? 0 : result.score,
    domainTier,
    role: vacancy.title,
    workMode: result.work_mode || 'unknown',
    reason: reason.slice(0, 2000),
    redFlags: flags.join(', '),
  }
}

const stringProfileCache = new Map<string, ReturnType<typeof parseCandidate>>()

export function getOrParseCandidate(
  resumeText: string,
  searchQueries: string[] = [],
): ReturnType<typeof parseCandidate> {
  const key = `${searchQueries.join('\0')}::${resumeText.length}::${resumeText.slice(0, 200)}`
  let profile = stringProfileCache.get(key)
  if (!profile) {
    profile = parseCandidate(resumeText, searchQueries)
    stringProfileCache.set(key, profile)
    if (stringProfileCache.size > 20) {
      const first = stringProfileCache.keys().next().value
      if (first) stringProfileCache.delete(first)
    }
  }
  return profile
}

export async function scoreVacancy(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[] = [],
): Promise<AtsResult> {
  const candidate = getOrParseCandidate(resumeText, searchQueries.filter(Boolean))
  const result = matchVacancy(candidate, vacancy, { debug: false })
  return toAts(result, vacancy)
}

export async function scoreVacancies(
  resumeText: string,
  vacancies: Vacancy[],
  searchQueries: string[] = [],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<AtsResult[]> {
  const candidate = getOrParseCandidate(resumeText, searchQueries.filter(Boolean))
  const out: AtsResult[] = []
  for (let i = 0; i < vacancies.length; i++) {
    out.push(toAts(matchVacancy(candidate, vacancies[i], { debug: false }), vacancies[i]))
    if (onProgress) await onProgress(i + 1, vacancies.length)
  }
  return out
}

/** Exposed for tests / debugging. */
export function scoreVacancyDetailed(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[] = [],
) {
  const candidate = getOrParseCandidate(resumeText, searchQueries.filter(Boolean))
  return matchVacancy(candidate, vacancy, { debug: true })
}
