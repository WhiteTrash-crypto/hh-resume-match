import { candidateMeetsLanguage } from './matchers/dimensions'
import { loadTaxonomies } from './taxonomies/loader'
import type {
  CandidateProfile,
  HardFilterReason,
  StructuredVacancy,
} from './types'

export function applyMatcherHardFilters(
  candidate: CandidateProfile,
  vacancy: StructuredVacancy,
): { rejected: boolean; reasons: HardFilterReason[] } {
  const cfg = loadTaxonomies().hardFilters
  const reasons: HardFilterReason[] = []

  if (cfg.hard_filters.employment_type.enabled) {
    if (
      vacancy.employment_type !== 'unknown' &&
      candidate.employment_types.length &&
      !candidate.employment_types.includes(vacancy.employment_type)
    ) {
      reasons.push({
        rule: 'employment_type',
        requirement: vacancy.employment_type,
        candidate: candidate.employment_types.join(','),
        evidence: `Employment type ${vacancy.employment_type} not in candidate preferences`,
      })
    }
  }

  if (cfg.hard_filters.location.enabled) {
    const remoteOnlyCandidate =
      candidate.remote_allowed && candidate.office_allowed_locations.length === 0
    if (
      vacancy.location.office &&
      !vacancy.location.remote &&
      !vacancy.location.hybrid &&
      remoteOnlyCandidate
    ) {
      reasons.push({
        rule: 'location',
        requirement: 'office',
        candidate: 'remote_only',
        evidence: 'Office-only role; candidate remote only',
      })
    }
    if (
      vacancy.location.remote &&
      vacancy.location.remote_scope.includes('us') &&
      candidate.work_authorization.length &&
      !candidate.work_authorization.includes('us')
    ) {
      reasons.push({
        rule: 'location',
        requirement: 'remote_us',
        candidate: candidate.work_authorization.join(','),
        evidence: 'Remote US only',
      })
    }
  }

  if (cfg.hard_filters.required_language.enabled) {
    for (const lang of vacancy.languages) {
      if (lang.requirement_type !== 'required') continue
      const ok = candidateMeetsLanguage(candidate, lang.language, lang.level)
      const okAlt =
        lang.language === 'chinese'
          ? candidateMeetsLanguage(candidate, 'mandarin', lang.level)
          : lang.language === 'mandarin'
            ? candidateMeetsLanguage(candidate, 'chinese', lang.level)
            : false
      if (!ok && !okAlt) {
        reasons.push({
          rule: 'required_language',
          requirement: `${lang.language} ${lang.level}`,
          candidate: candidate.languages[lang.language] || 'none',
          evidence: lang.evidence,
        })
      }
    }
  }

  if (cfg.hard_filters.mandatory_certification.enabled) {
    for (const cert of vacancy.certifications) {
      if (cert.requirement_type !== 'required') continue
      if (!candidate.certifications.includes(cert.id)) {
        reasons.push({
          rule: 'mandatory_certification',
          requirement: cert.id,
          candidate: 'none',
          evidence: cert.id,
        })
      }
    }
  }

  const uniq = new Map<string, HardFilterReason>()
  for (const r of reasons) uniq.set(`${r.rule}:${r.requirement}`, r)

  return { rejected: uniq.size > 0, reasons: [...uniq.values()] }
}
