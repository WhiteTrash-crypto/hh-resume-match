import { includesPhrase } from '../normalize'
import { loadTaxonomies } from '../taxonomies/loader'
import type { MatchEvidence } from '../types'

export function extractResponsibilityIds(text: string): string[] {
  const { responsibilities } = loadTaxonomies()
  const found = new Set<string>()
  for (const [id, entry] of Object.entries(responsibilities)) {
    for (const p of entry.patterns) {
      if (includesPhrase(text, p)) {
        found.add(id)
        break
      }
    }
  }
  return [...found]
}

export function scoreResponsibilities(
  candidateIds: string[],
  vacancyIds: string[],
  candidateRaw: string,
  candidateSkills: string[] = [],
): { score: number; matched: MatchEvidence[]; missing: MatchEvidence[] } {
  // Skills that double as responsibility evidence (roadmap, backlog, …)
  const enriched = new Set([
    ...candidateIds,
    ...candidateSkills,
    ...extractResponsibilityIds(candidateRaw),
  ])
  if (!vacancyIds.length) {
    return { score: 50, matched: [], missing: [] }
  }
  const matched: MatchEvidence[] = []
  const missing: MatchEvidence[] = []
  let hits = 0
  for (const id of vacancyIds) {
    if (enriched.has(id)) {
      hits += 1
      matched.push({
        type: 'responsibility',
        requirement: id,
        candidate_match: id,
        match_type: 'exact',
        credit: 1,
      })
    } else {
      missing.push({ type: 'responsibility', requirement: id })
    }
  }
  return {
    score: Math.round((hits / vacancyIds.length) * 100),
    matched,
    missing,
  }
}
