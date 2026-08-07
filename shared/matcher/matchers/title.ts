import { includesPhrase, normalizeText } from '../normalize'
import { loadTaxonomies } from '../taxonomies/loader'
import type { LanguageLevel, SeniorityLevel } from '../types'

export function detectSeniority(text: string): SeniorityLevel {
  const { seniority } = loadTaxonomies()
  const n = normalizeText(text)
  const order: SeniorityLevel[] = [
    'c_level',
    'vp',
    'director',
    'head',
    'lead',
    'senior',
    'middle_plus',
    'middle',
    'junior',
    'intern',
  ]
  for (const level of order) {
    for (const alias of seniority[level] || []) {
      if (includesPhrase(n, alias)) return level
    }
  }
  return 'unknown'
}

export function normalizeTitle(text: string): { id: string | null; family: string | null } {
  const { titles, titleAliasIndex } = loadTaxonomies()
  const n = normalizeText(text)

  // Prefer longer aliases first
  const aliases = [...titleAliasIndex.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [alias, id] of aliases) {
    if (alias.length < 2) continue
    if (includesPhrase(n, alias)) {
      return { id, family: titles[id]?.family || null }
    }
  }
  return { id: null, family: null }
}

export function scoreTitleMatch(
  candidateRoles: string[],
  vacancyTitleId: string | null,
  vacancyTitleRaw: string,
): { score: number; matchType: string; matchedRole: string | null } {
  const tax = loadTaxonomies()
  const { title_scores } = tax.scoring
  const vac =
    vacancyTitleId ||
    normalizeTitle(vacancyTitleRaw).id

  if (!vac) {
    // Fallback: query/role token overlap via aliases present in raw title
    for (const role of candidateRoles) {
      const entry = tax.titles[role]
      if (!entry) continue
      for (const a of entry.aliases) {
        if (includesPhrase(vacancyTitleRaw, a)) {
          return { score: title_scores.alias, matchType: 'alias', matchedRole: role }
        }
      }
    }
    return { score: title_scores.unrelated, matchType: 'unrelated', matchedRole: null }
  }

  for (const role of candidateRoles) {
    if (role === vac) {
      return { score: title_scores.exact, matchType: 'exact', matchedRole: role }
    }
    const cand = tax.titles[role]
    const vacEntry = tax.titles[vac]
    if (!cand || !vacEntry) continue

    if (cand.subtypes?.includes(vac) || vacEntry.subtypes?.includes(role)) {
      return { score: title_scores.subtype, matchType: 'subtype', matchedRole: role }
    }
    if (cand.family && vacEntry.family && cand.family === vacEntry.family) {
      return { score: title_scores.parent_child, matchType: 'parent_child', matchedRole: role }
    }
    const rel = cand.related?.[vac] ?? vacEntry.related?.[role]
    if (rel != null) {
      if (rel >= 0.5) {
        return {
          score: title_scores.strongly_related,
          matchType: 'strongly_related',
          matchedRole: role,
        }
      }
      return {
        score: Math.round(title_scores.weakly_related + rel * 30),
        matchType: 'weakly_related',
        matchedRole: role,
      }
    }
  }

  // Alias of candidate role equals vacancy id
  for (const role of candidateRoles) {
    const entry = tax.titles[role]
    if (!entry) continue
    if (entry.aliases.some((a) => normalizeTitle(a).id === vac)) {
      return { score: title_scores.alias, matchType: 'alias', matchedRole: role }
    }
  }

  return { score: title_scores.unrelated, matchType: 'unrelated', matchedRole: null }
}

const LANG_ORDER: LanguageLevel[] = [
  'a1',
  'a2',
  'b1',
  'b2',
  'c1',
  'c2',
  'fluent',
  'native',
]

export function languageRank(level: LanguageLevel): number {
  const { languages } = loadTaxonomies()
  return languages.levels[level] ?? 0
}

export function parseLanguageLevel(text: string): LanguageLevel {
  const { languages } = loadTaxonomies()
  const n = normalizeText(text)
  for (const level of [...LANG_ORDER].reverse()) {
    for (const phrase of languages.level_phrases[level] || []) {
      if (includesPhrase(n, phrase)) return level as LanguageLevel
    }
  }
  return 'unknown'
}

export function extractYears(text: string): {
  minimum: number | null
  maximum: number | null
  strict: boolean
} {
  const n = normalizeText(text)
  const patterns: Array<{ re: RegExp; strict?: boolean }> = [
    { re: /(?:at least|minimum of|minimum|не менее|минимум)\s*(\d+)\+?\s*years?/, strict: true },
    { re: /(\d+)\+\s*years?/, strict: false },
    { re: /more than\s*(\d+)\s*years?/, strict: false },
    { re: /(\d+)\s*-\s*(\d+)\s*years?/ },
    { re: /(\d+)\s+to\s+(\d+)\s*years?/ },
    { re: /(\d+)\s*years?\s+(?:of\s+)?(?:relevant\s+|total\s+|hands-on\s+)?(?:experience|опыт)/ },
    { re: /(\d+)\s*years?\s+relevant/, strict: false },
    { re: /опыт\s*(?:работы\s*)?(?:от\s*)?(\d+)/ },
    { re: /(\d+)\s*(?:года|лет)\s+(?:опыта|опыт)/ },
  ]
  for (const { re, strict } of patterns) {
    const m = n.match(re)
    if (!m) continue
    if (m[2]) {
      return { minimum: Number(m[1]), maximum: Number(m[2]), strict: Boolean(strict) }
    }
    return { minimum: Number(m[1]), maximum: null, strict: Boolean(strict) }
  }
  return { minimum: null, maximum: null, strict: false }
}
