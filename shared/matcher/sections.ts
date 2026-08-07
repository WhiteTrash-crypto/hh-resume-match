import { includesPhrase, normalizeText } from './normalize'
import { loadTaxonomies } from './taxonomies/loader'
import type { RequirementType } from './types'

export type DetectedSections = Record<string, string>

const HEADING_RE =
  /(?:^|\n)\s{0,3}(?:#{1,3}\s*)?([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 /&'+-]{2,60})\s*:?\s*(?:\n|$)/g

/**
 * Split vacancy/CV text into named sections by heading patterns.
 */
export function detectSections(text: string): DetectedSections {
  const { markers } = loadTaxonomies()
  const headingToSection = new Map<string, string>()
  for (const [section, headings] of Object.entries(markers.sections)) {
    for (const h of headings) {
      headingToSection.set(normalizeText(h), section)
    }
  }

  const raw = text || ''
  const matches: Array<{ index: number; end: number; section: string; heading: string }> = []
  let m: RegExpExecArray | null
  const re = new RegExp(HEADING_RE.source, 'gi')
  while ((m = re.exec(raw)) !== null) {
    const heading = normalizeText(m[1])
    let section: string | undefined
    for (const [alias, sec] of headingToSection) {
      if (heading === alias || heading.startsWith(alias) || alias.startsWith(heading)) {
        section = sec
        break
      }
    }
    if (!section) continue
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      section,
      heading,
    })
  }

  const sections: DetectedSections = { full: raw }
  if (!matches.length) {
    sections.requirements = raw
    sections.responsibilities = raw
    return sections
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end
    const stop = i + 1 < matches.length ? matches[i + 1].index : raw.length
    const body = raw.slice(start, stop).trim()
    const key = matches[i].section
    sections[key] = sections[key] ? `${sections[key]}\n${body}` : body
  }
  return sections
}

export function classifyRequirement(
  sentence: string,
  sourceSection?: string,
): RequirementType {
  const { markers } = loadTaxonomies()
  const n = normalizeText(sentence)

  // Required markers take precedence when both appear in a noisy window (§9.3).
  for (const r of markers.required) {
    if (includesPhrase(n, r)) return 'required'
  }
  for (const p of markers.preferred) {
    if (includesPhrase(n, p)) return 'preferred'
  }

  if (sourceSection === 'nice_to_have') return 'preferred'
  if (sourceSection === 'requirements' || sourceSection === 'mandatory') return 'required'
  return 'unknown'
}

export function splitSentences(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?\n;•])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
}
