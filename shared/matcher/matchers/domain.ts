import { includesPhrase } from '../normalize'
import { loadTaxonomies } from '../taxonomies/loader'
import type { MatchEvidence } from '../types'

export function extractDomainIds(text: string): string[] {
  const { domains, domainAliasIndex } = loadTaxonomies()
  const found = new Set<string>()
  const aliases = [...domainAliasIndex.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [alias, id] of aliases) {
    if (alias.length < 2) continue
    if (includesPhrase(text, alias)) found.add(id)
  }
  for (const id of Object.keys(domains)) {
    if (includesPhrase(text, id.replace(/_/g, ' '))) found.add(id)
  }
  return [...found]
}

function pairScore(a: string, b: string): number {
  const tax = loadTaxonomies()
  const scores = tax.scoring.domain_scores
  if (a === b) return scores.exact
  const A = tax.domains[a]
  const B = tax.domains[b]
  if (!A || !B) return scores.unrelated
  if (A.parent === b || B.parent === a) return scores.parent_child
  const rel = A.related?.[b] ?? B.related?.[a]
  if (rel != null) {
    if (rel >= 0.7) return scores.close_adjacent
    if (rel >= 0.4) return scores.weak_adjacent
  }
  // Shared parent
  if (A.parent && A.parent === B.parent) return scores.close_adjacent
  return scores.unrelated
}

export function scoreDomains(
  candidateDomains: string[],
  vacancyDomains: string[],
  candidateRaw: string,
): { score: number; matched: MatchEvidence[] } {
  const cand = [...new Set([...candidateDomains, ...extractDomainIds(candidateRaw)])]
  if (!vacancyDomains.length) {
    return { score: 50, matched: [] }
  }
  if (!cand.length) {
    return { score: 40, matched: [] }
  }
  let bestOverall = 0
  const matched: MatchEvidence[] = []
  for (const vd of vacancyDomains) {
    let best = 0
    let bestCand: string | null = null
    for (const cd of cand) {
      const s = pairScore(cd, vd)
      if (s > best) {
        best = s
        bestCand = cd
      }
    }
    bestOverall = Math.max(bestOverall, best)
    if (bestCand && best > 0) {
      matched.push({
        type: 'domain',
        requirement: vd,
        candidate_match: bestCand,
        match_type: best >= 100 ? 'exact' : 'related',
        credit: best / 100,
      })
    }
  }
  // Average of best per vacancy domain, floored by overall best
  let sum = 0
  for (const vd of vacancyDomains) {
    let best = 0
    for (const cd of cand) best = Math.max(best, pairScore(cd, vd))
    sum += best
  }
  return {
    score: Math.round(sum / vacancyDomains.length),
    matched,
  }
}
