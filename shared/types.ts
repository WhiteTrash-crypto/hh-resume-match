export type ResumeMeta = {
  id: string
  filename: string
  uploadedAt: string
  chars: number
}

export type SearchConfig = {
  sheetUrl: string
  sheetId: string
  query: string
  /** Comma-separated regions (fuzzy → HH area ids). Empty = all Russia. */
  regions: string
  remoteOnly: boolean
  periodDays: number
  maxPages: number
}

export type JobState = {
  id: string
  status:
    | 'idle'
    | 'collecting'
    | 'filtering'
    | 'scoring'
    | 'writing'
    | 'done'
    | 'error'
  message: string
  /** @deprecated use apifyRunIds */
  apifyRunId?: string
  apifyRunIds?: string[]
  queries?: string[]
  /** Total vacancy budget for this run (by key count). */
  vacancyBudget?: number
  startedAt?: string
  finishedAt?: string
  stats?: {
    fetched: number
    afterHardFilter: number
    scored: number
    writtenQualified: number
    writtenCandidates: number
  }
  error?: string
}

export type SessionData = {
  id: string
  createdAt: string
  updatedAt: string
  resumes: ResumeMeta[]
  /** resumeId → plain text */
  resumeTexts: Record<string, string>
  config: Partial<SearchConfig>
  job: JobState
  /** Temporary pipeline buffer */
  pipeline?: {
    vacancies: Vacancy[]
    scores: AtsResult[]
    cursor: number
  }
}

export type Vacancy = {
  vacancyId: string
  url: string
  title: string
  employer: string
  location: string
  salary: string
  experience: string
  schedule: string
  snippet: string
  content: string
}

export type AtsResult = {
  vacancyId: string
  score: number
  domainTier: 'A' | 'B' | 'C'
  role: string
  workMode: string
  reason: string
  redFlags: string
}
