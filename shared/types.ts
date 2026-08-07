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
  /** Comma-separated regions/countries (fuzzy → HH area ids). Empty = no geo filter. */
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

/** In-flight HH collect state between status polls. */
export type HhCollectState = {
  queries: string[]
  pagesPerQuery: number[]
  vacanciesPerQuery: number[]
  vacancyBudget: number
  areaIds: string[]
  remoteOnly: boolean
  periodDays: number
  phase: 'search' | 'details' | 'done'
  ids: string[]
  cards: Record<string, Record<string, unknown>>
  detailsDone: number
  items: Vacancy[]
  /** Set when HH_SCRAPE_MODE=apify after actor start */
  apifyRunId?: string
  /** Present if this job auto-fell back from Apify to fetch */
  fellBackFromApify?: string
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
  /** Access-key unlock bound to this browser session */
  access?: {
    /** Plain key (matches column A in keys sheet) */
    key: string
    usesLeft: number
    unlockedAt: string
  }
  /** Temporary pipeline buffer */
  pipeline?: {
    vacancies: Vacancy[]
    scores: AtsResult[]
    cursor: number
    collect?: HhCollectState
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
