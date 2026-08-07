import type {
  DomainEntry,
  HardFiltersConfig,
  ResponsibilityEntry,
  ScoringConfig,
  SkillEntry,
  TitleEntry,
} from '../types'

import scoringJson from '../config/scoring.json'
import hardFiltersJson from '../config/hard_filters.json'
import titlesJson from '../config/titles.json'
import skillsJson from '../config/skills.json'
import responsibilitiesJson from '../config/responsibilities.json'
import domainsJson from '../config/domains.json'
import seniorityJson from '../config/seniority.json'
import languagesJson from '../config/languages.json'
import markersJson from '../config/requirement_markers.json'

export type MarkersConfig = {
  required: string[]
  preferred: string[]
  sections: Record<string, string[]>
}

export type LanguagesConfig = {
  levels: Record<string, number>
  aliases: Record<string, string[]>
  level_phrases: Record<string, string[]>
}

export type TaxonomyBundle = {
  scoring: ScoringConfig
  hardFilters: HardFiltersConfig
  titles: Record<string, TitleEntry>
  skills: Record<string, SkillEntry>
  responsibilities: Record<string, ResponsibilityEntry>
  domains: Record<string, DomainEntry>
  seniority: Record<string, string[]>
  languages: LanguagesConfig
  markers: MarkersConfig
  /** alias/normalized phrase → canonical title id */
  titleAliasIndex: Map<string, string>
  /** alias → skill id */
  skillAliasIndex: Map<string, string>
  /** alias → domain id */
  domainAliasIndex: Map<string, string>
}

function buildAliasIndex(
  entries: Record<string, { aliases?: string[] }>,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const [id, entry] of Object.entries(entries)) {
    m.set(id.replace(/_/g, ' '), id)
    m.set(id, id)
    for (const a of entry.aliases || []) {
      m.set(a.toLowerCase(), id)
    }
  }
  return m
}

let cached: TaxonomyBundle | null = null

export function loadTaxonomies(): TaxonomyBundle {
  if (cached) return cached
  const titles = titlesJson as Record<string, TitleEntry>
  const skills = skillsJson as Record<string, SkillEntry>
  const domains = domainsJson as Record<string, DomainEntry>
  cached = {
    scoring: scoringJson as ScoringConfig,
    hardFilters: hardFiltersJson as HardFiltersConfig,
    titles,
    skills,
    responsibilities: responsibilitiesJson as Record<string, ResponsibilityEntry>,
    domains,
    seniority: seniorityJson as Record<string, string[]>,
    languages: languagesJson as LanguagesConfig,
    markers: markersJson as MarkersConfig,
    titleAliasIndex: buildAliasIndex(titles),
    skillAliasIndex: buildAliasIndex(skills),
    domainAliasIndex: buildAliasIndex(domains),
  }
  return cached
}

/** Reset cache (tests). */
export function resetTaxonomyCache(): void {
  cached = null
}
