import { fuzzyRatio, includesPhrase, normalizeText } from '../normalize'
import { loadTaxonomies } from '../taxonomies/loader'
import type { MatchEvidence, VacancySkill } from '../types'

export type SkillMatch = {
  score: number
  matched: MatchEvidence[]
  missing_required: MatchEvidence[]
  missing_preferred: MatchEvidence[]
  penalty: number
}

export function extractSkillIds(text: string): string[] {
  const { skills, skillAliasIndex } = loadTaxonomies()
  const found = new Set<string>()
  const n = normalizeText(text)
  const aliases = [...skillAliasIndex.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [alias, id] of aliases) {
    if (alias.length < 2) continue
    if (!includesPhrase(n, alias)) continue
    const a = normalizeText(alias)
    const idx = n.indexOf(a)
    if (idx >= 0) {
      const before = n.slice(Math.max(0, idx - 12), idx)
      if (/\b(no|not|without|без|нет)\s*$/i.test(before)) continue
    }
    found.add(id)
  }
  for (const id of Object.keys(skills)) {
    const label = id.replace(/_/g, ' ')
    if (!includesPhrase(n, label)) continue
    const idx = n.indexOf(normalizeText(label))
    if (idx >= 0) {
      const before = n.slice(Math.max(0, idx - 12), idx)
      if (/\b(no|not|without|без|нет)\s*$/i.test(before)) continue
    }
    found.add(id)
  }
  return [...found]
}

function bestCandidateMatch(
  requiredId: string,
  candidateSkills: string[],
): { credit: number; matchType: string; matched: string | null } {
  const tax = loadTaxonomies()
  const credits = tax.scoring.skill_match_credit
  const req = tax.skills[requiredId]
  if (!req) {
    // Unknown skill id — check raw presence via alias equality
    if (candidateSkills.includes(requiredId)) {
      return { credit: credits.exact, matchType: 'exact', matched: requiredId }
    }
    return { credit: credits.missing, matchType: 'missing', matched: null }
  }

  if (candidateSkills.includes(requiredId)) {
    return { credit: credits.exact, matchType: 'exact', matched: requiredId }
  }

  for (const cs of candidateSkills) {
    const cand = tax.skills[cs]
    if (!cand) continue
    if (req.substitutes?.includes(cs) || cand.substitutes?.includes(requiredId)) {
      return { credit: credits.substitute, matchType: 'substitute', matched: cs }
    }
    const reqGroups = new Set(req.groups || [])
    const candGroups = cand.groups || []
    if (candGroups.some((g) => reqGroups.has(g))) {
      return { credit: credits.same_group, matchType: 'same_group', matched: cs }
    }
    if (req.related?.includes(cs) || cand.related?.includes(requiredId)) {
      return { credit: credits.related, matchType: 'related', matched: cs }
    }
  }

  // Fuzzy alias vs candidate skill aliases
  const thresh = tax.scoring.fuzzy_matching.strong_threshold
  for (const cs of candidateSkills) {
    const cand = tax.skills[cs]
    if (!cand) continue
    for (const ra of req.aliases) {
      for (const ca of cand.aliases) {
        if (ra.length < 4 || ca.length < 4) continue
        if (fuzzyRatio(ra, ca) >= thresh) {
          return { credit: credits.alias, matchType: 'alias', matched: cs }
        }
      }
    }
  }

  return { credit: credits.missing, matchType: 'missing', matched: null }
}

export function scoreSkills(
  candidateSkills: string[],
  vacancySkills: VacancySkill[],
  candidateRaw: string,
): SkillMatch {
  const tax = loadTaxonomies()
  const reqWeights = tax.scoring.requirement_weights
  const penalties = tax.scoring.penalties

  // Enrich candidate skills from raw text if sparse
  const enriched = new Set([
    ...candidateSkills,
    ...extractSkillIds(candidateRaw),
  ])
  const candList = [...enriched]

  if (!vacancySkills.length) {
    return {
      score: 50,
      matched: [],
      missing_required: [],
      missing_preferred: [],
      penalty: 0,
    }
  }

  let weightedSum = 0
  let weightTotal = 0
  const matched: MatchEvidence[] = []
  const missing_required: MatchEvidence[] = []
  const missing_preferred: MatchEvidence[] = []
  let penalty = 0

  for (const vs of vacancySkills) {
    const w = reqWeights[vs.requirement_type] ?? 0.6
    weightTotal += w
    const best = bestCandidateMatch(vs.id, candList)
    weightedSum += w * best.credit
    if (best.matched) {
      matched.push({
        type: 'skill',
        requirement: vs.id,
        candidate_match: best.matched,
        match_type: best.matchType,
        credit: best.credit,
        evidence: vs.evidence,
      })
    } else if (vs.requirement_type === 'required') {
      missing_required.push({
        type: 'skill',
        requirement: vs.id,
        evidence: vs.evidence,
      })
      const critical = vs.critical || tax.skills[vs.id]?.critical
      penalty += critical
        ? penalties.missing_required_critical
        : penalties.missing_required_normal
    } else if (vs.requirement_type === 'preferred') {
      missing_preferred.push({ type: 'skill', requirement: vs.id, evidence: vs.evidence })
      penalty += penalties.missing_preferred
    }
  }

  penalty = Math.min(penalty, penalties.max_total_missing_penalty)
  const score01 = weightTotal > 0 ? weightedSum / weightTotal : 0.5
  return {
    score: Math.round(score01 * 100),
    matched,
    missing_required,
    missing_preferred,
    penalty,
  }
}

export function extractSkillsFromVacancyText(
  text: string,
  section?: string,
  classify?: (sentence: string, section?: string) => 'required' | 'preferred' | 'unknown',
): VacancySkill[] {
  const { skills, skillAliasIndex } = loadTaxonomies()
  const out: VacancySkill[] = []
  const seen = new Set<string>()
  const aliases = [...skillAliasIndex.entries()].sort((a, b) => b[0].length - a[0].length)
  const n = normalizeText(text)

  for (const [alias, id] of aliases) {
    if (alias.length < 2 || seen.has(id)) continue
    if (!includesPhrase(n, alias)) continue
    seen.add(id)
    const a = normalizeText(alias)
    const idx = n.indexOf(a)
    const window = idx >= 0 ? n.slice(Math.max(0, idx - 40), idx + a.length + 60) : a
    const requirement_type = classify
      ? classify(window, section)
      : section === 'nice_to_have'
        ? 'preferred'
        : section === 'requirements'
          ? 'required'
          : 'unknown'
    out.push({
      id,
      requirement_type,
      evidence: alias,
      source_section: section,
      critical: skills[id]?.critical,
    })
  }
  return out
}
