export type RequirementType = 'required' | 'preferred' | 'unknown'

export type SeniorityLevel =
  | 'intern'
  | 'junior'
  | 'middle'
  | 'middle_plus'
  | 'senior'
  | 'lead'
  | 'head'
  | 'director'
  | 'vp'
  | 'c_level'
  | 'unknown'

export type LanguageLevel =
  | 'a1'
  | 'a2'
  | 'b1'
  | 'b2'
  | 'c1'
  | 'c2'
  | 'fluent'
  | 'native'
  | 'unknown'

export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary'
  | 'internship'
  | 'freelance'
  | 'unknown'

export type ScoreBand = 'excellent' | 'good' | 'possible' | 'weak' | 'poor'

export type CandidateProfile = {
  target_roles: string[]
  acceptable_roles: string[]
  seniority: SeniorityLevel
  years_total_experience: number | null
  years_relevant_experience: number | null
  domains: string[]
  skills: string[]
  responsibilities: string[]
  management: {
    people_management: boolean
    max_team_size: number | null
    hiring: boolean
    budget_ownership: boolean
    pnl: boolean
    mentoring: boolean
  }
  languages: Record<string, LanguageLevel>
  locations: string[]
  remote_allowed: boolean
  office_allowed_locations: string[]
  work_authorization: string[]
  min_salary: number | null
  employment_types: EmploymentType[]
  education: string[]
  certifications: string[]
  /** Raw normalized resume text for fallback token matching */
  raw_text: string
  search_queries: string[]
}

export type VacancySkill = {
  id: string
  requirement_type: RequirementType
  evidence: string
  source_section?: string
  critical?: boolean
}

export type VacancyLanguage = {
  language: string
  level: LanguageLevel
  requirement_type: RequirementType
  evidence: string
}

export type StructuredVacancy = {
  id: string
  title_raw: string
  title_normalized: string | null
  seniority: SeniorityLevel
  company: string
  location: {
    countries: string[]
    cities: string[]
    remote: boolean
    remote_scope: string[]
    hybrid: boolean
    office: boolean
    relocation: boolean
  }
  salary: {
    min: number | null
    max: number | null
    currency: string | null
    period: string | null
    explicit: boolean
  }
  employment_type: EmploymentType
  experience: {
    minimum_years_total: number | null
    minimum_years_role: number | null
    strict: boolean
    requirement_type: RequirementType
  }
  languages: VacancyLanguage[]
  skills: VacancySkill[]
  responsibilities: string[]
  domains: string[]
  management_requirements: {
    people_management: boolean
    hiring: boolean
    pnl: boolean
    mentoring: boolean
  }
  education: string[]
  certifications: Array<{ id: string; requirement_type: RequirementType }>
  sections: Record<string, string>
  raw_text: string
  work_mode: string
}

export type MatchEvidence = {
  type: string
  requirement: string
  candidate_match?: string
  match_type?: string
  credit?: number
  evidence?: string
}

export type DimensionScores = {
  role: number
  responsibilities: number
  skills: number
  domain: number
  seniority: number
  experience: number
  management: number
  education_certifications: number
}

export type HardFilterReason = {
  rule: string
  requirement: string
  candidate: string
  evidence: string
}

export type RuleTraceEntry = {
  rule: string
  [key: string]: unknown
}

export type MatchResult = {
  vacancy_id: string
  rejected: boolean
  score: number
  band: ScoreBand
  confidence: number
  dimensions: DimensionScores
  matched: MatchEvidence[]
  missing_required: MatchEvidence[]
  missing_preferred: MatchEvidence[]
  hard_filter_reasons: HardFilterReason[]
  reasons: string[]
  work_mode: string
  debug?: { rule_trace: RuleTraceEntry[] }
}

export type TitleEntry = {
  aliases: string[]
  subtypes?: string[]
  related?: Record<string, number>
  family?: string
}

export type SkillEntry = {
  aliases: string[]
  groups?: string[]
  related?: string[]
  substitutes?: string[]
  critical?: boolean
}

export type ResponsibilityEntry = {
  patterns: string[]
}

export type DomainEntry = {
  parent?: string | null
  aliases?: string[]
  related?: Record<string, number>
}

export type ScoringConfig = {
  weights: DimensionScores
  score_bands: { excellent: number; good: number; possible: number; weak: number }
  feed: { primary_min_score: number; secondary_min_score: number; explore_min_score: number }
  requirement_weights: Record<RequirementType, number>
  skill_match_credit: {
    exact: number
    alias: number
    substitute: number
    same_group: number
    related: number
    missing: number
  }
  title_scores: {
    exact: number
    alias: number
    subtype: number
    parent_child: number
    strongly_related: number
    weakly_related: number
    unrelated: number
  }
  domain_scores: {
    exact: number
    parent_child: number
    close_adjacent: number
    weak_adjacent: number
    unrelated: number
  }
  seniority_matrix: Record<string, Record<string, number>>
  experience_scoring: {
    exact_or_above: number
    minus_1: number
    minus_2: number
    half: number
    below_half: number
    unknown: number
  }
  penalties: {
    missing_required_critical: number
    missing_required_normal: number
    missing_preferred: number
    max_total_missing_penalty: number
  }
  fuzzy_matching: { strong_threshold: number; contextual_threshold: number }
  repetition: { max_multiplier: number }
}

export type HardFiltersConfig = {
  hard_filters: {
    required_language: { enabled: boolean }
    location: { enabled: boolean }
    work_authorization: { enabled: boolean }
    employment_type: { enabled: boolean }
    mandatory_certification: { enabled: boolean }
    mandatory_domain: { enabled: boolean }
    salary: { enabled: boolean; reject_if_below_candidate_min_percent: number }
    years_experience: { enabled: boolean }
    critical_skill: { enabled: boolean }
  }
  policy: {
    reject_only_explicit_requirements: boolean
    reject_unknown_requirement_type: boolean
    low_confidence_disables_non_explicit_rejects: boolean
  }
}
