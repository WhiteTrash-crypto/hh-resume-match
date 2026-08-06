import { ApifyClient } from 'apify-client'
import {
  distributeVacancyBudget,
  pagesForVacancyAllotment,
  vacancyBudgetForKeyCount,
} from './budget'
import { DEFAULT_AREA_ID, resolveRegions } from './regions'
import type { Vacancy } from './types'

const EXPERIENCE_LABELS: Record<string, string> = {
  noExperience: 'нет опыта',
  between1And3: 'от 1 до 3 лет',
  between3And6: 'от 3 до 6 лет',
  moreThan6: 'более 6 лет',
}

const SCHEDULE_LABELS: Record<string, string> = {
  remote: 'удалённая работа',
  REMOTE: 'удалённая работа',
  hybrid: 'гибрид',
  HYBRID: 'гибрид',
  ON_SITE: 'офис',
  FULL: 'полная занятость',
}

function buildSearchUrl(opts: {
  query: string
  remoteOnly: boolean
  periodDays: number
  areaIds?: string[]
}): string {
  const params = new URLSearchParams()
  params.set('text', opts.query)
  params.set('search_period', String(opts.periodDays))
  params.set('order_by', 'publication_time')
  params.set('items_on_page', '50')
  const areas =
    opts.areaIds?.filter(Boolean).length
      ? [...new Set(opts.areaIds.filter(Boolean))]
      : [DEFAULT_AREA_ID]
  for (const area of areas) params.append('area', area)
  if (opts.remoteOnly) params.append('schedule', 'remote')
  return `https://hh.ru/search/vacancy?${params.toString()}`
}

/** Split comma-separated keys, max 5 unique non-empty. */
export function parseSearchQueries(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of (raw || '').split(',')) {
    const q = part.trim().replace(/\s+/g, ' ')
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= 5) break
  }
  return out
}

/**
 * Split a vacancy budget across N queries, then convert each allotment to pages.
 * @deprecated prefer distributeVacancyBudget + pagesForVacancyAllotment
 */
export function distributePageBudget(totalPages: number, queryCount: number): number[] {
  const n = Math.max(0, queryCount)
  if (n === 0) return []
  const total = Math.max(1, Math.min(10, Math.floor(totalPages) || 1))
  const base = Math.floor(total / n)
  const rem = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickName(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name?: string }).name || '')
  }
  return String(value)
}

export function normalizeVacancy(item: Record<string, unknown>): Vacancy | null {
  const vacancyId = String(item.vacancyId || item.id || '').trim()
  let url = String(item.url || item.alternate_url || '').trim()
  if (!vacancyId && url) {
    const id = url.split('/').pop()?.split('?')[0]
    if (!id) return null
  }
  const id = vacancyId || url.split('/').pop()?.split('?')[0] || ''
  if (!id) return null
  if (!url) url = `https://hh.ru/vacancy/${id}`

  const title = String(item.title || item.name || '').trim()
  const company = (item.employer || item.company || {}) as Record<string, unknown>
  const employer = String(
    (typeof company === 'object' && company
      ? company.visibleName || company.name
      : company) || '',
  )
  const area = item.area as { name?: string } | string | undefined
  const location =
    typeof area === 'object' && area ? area.name || '' : String(area || item.location || '')

  const salaryFrom = item.salaryFrom as number | null | undefined
  const salaryTo = item.salaryTo as number | null | undefined
  const salaryCurrency = String(item.salaryCurrency || '')
  let salary = String(item.salaryText || '')
  if (!salary && (salaryFrom || salaryTo)) {
    salary = [salaryFrom ? `от ${salaryFrom}` : '', salaryTo ? `до ${salaryTo}` : '']
      .filter(Boolean)
      .join(' ')
    if (salaryCurrency) salary = `${salary} ${salaryCurrency}`
  }

  const experience = EXPERIENCE_LABELS[String(item.workExperience || '')] ||
    pickName(item.experience) ||
    String(item.workExperience || '')
  const schedule =
    SCHEDULE_LABELS[String(item.workSchedule || '')] ||
    SCHEDULE_LABELS[String((item.workFormats as string[] | undefined)?.[0] || '')] ||
    pickName(item.schedule) ||
    String(item.workSchedule || '')

  const description = stripHtml(
    String(item.descriptionText || item.description || ''),
  )
  const snippet = stripHtml(String(item.snippet || '')) || description.slice(0, 280)

  const content = [title, employer, location, salary, experience, schedule, snippet, description]
    .filter(Boolean)
    .join('\n')

  return {
    vacancyId: id,
    url,
    title,
    employer,
    location,
    salary,
    experience,
    schedule,
    snippet,
    content,
  }
}

export async function startHhCollect(opts: {
  query: string
  remoteOnly: boolean
  periodDays: number
  /** Comma-separated region names; empty → all Russia */
  regions?: string
  /** Optional override; by default derived from key count. */
  vacancyBudget?: number
}): Promise<{
  runIds: string[]
  queries: string[]
  pagesPerQuery: number[]
  vacanciesPerQuery: number[]
  vacancyBudget: number
  areaIds: string[]
  regionsResolved: { input: string; id: string; name: string }[]
}> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN не задан')
  const actor = process.env.APIFY_ACTOR
  if (!actor) throw new Error('APIFY_ACTOR не задан')

  const queries = parseSearchQueries(opts.query)
  if (!queries.length) throw new Error('Укажите хотя бы один поисковый ключ')

  const regionResult = resolveRegions(opts.regions || '')
  if ((opts.regions || '').trim() && regionResult.unresolved.length) {
    throw new Error(
      `Не удалось распознать регион(ы): ${regionResult.unresolved.join(', ')}. ` +
        'Примеры: Москва, СПб, Питер, Казань, Екатеринбург',
    )
  }
  if ((opts.regions || '').trim() && !regionResult.areaIds.length) {
    throw new Error('Укажите хотя бы один понятный регион или оставьте поле пустым (вся Россия)')
  }
  const areaIds = regionResult.areaIds.length ? regionResult.areaIds : [DEFAULT_AREA_ID]

  const vacancyBudget =
    opts.vacancyBudget && opts.vacancyBudget > 0
      ? Math.floor(opts.vacancyBudget)
      : vacancyBudgetForKeyCount(queries.length)
  const vacanciesPerQuery = distributeVacancyBudget(vacancyBudget, queries.length)
  const pagesPerQuery = vacanciesPerQuery.map(pagesForVacancyAllotment)
  const client = new ApifyClient({ token })
  const runIds: string[] = []

  // One Apify run per key that got ≥1 page from the shared budget
  for (let i = 0; i < queries.length; i++) {
    const pages = pagesPerQuery[i]
    if (pages <= 0) continue
    const searchUrl = buildSearchUrl({
      query: queries[i],
      remoteOnly: opts.remoteOnly,
      periodDays: opts.periodDays,
      areaIds,
    })
    const run = await client.actor(actor).start({
      mode: 'url',
      urls: [searchUrl],
      maxPages: pages,
      fetchDetails: true,
    })
    if (!run?.id) throw new Error(`Не удалось запустить Apify для «${queries[i]}»`)
    runIds.push(run.id)
  }

  if (!runIds.length) {
    throw new Error('Бюджет страниц слишком мал для выбранных ключей')
  }

  return {
    runIds,
    queries,
    pagesPerQuery,
    vacanciesPerQuery,
    vacancyBudget,
    areaIds,
    regionsResolved: regionResult.resolved,
  }
}

export async function getHhCollectStatus(runIds: string[]): Promise<{
  status: string
  items?: Vacancy[]
  done: number
  total: number
}> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN не задан')
  const client = new ApifyClient({ token })
  const ids = runIds.filter(Boolean)
  if (!ids.length) return { status: 'UNKNOWN', done: 0, total: 0 }

  const statuses: string[] = []
  const datasetIds: string[] = []

  for (const runId of ids) {
    const run = await client.run(runId).get()
    if (!run) {
      statuses.push('UNKNOWN')
      continue
    }
    const st = String(run.status || 'UNKNOWN')
    statuses.push(st)
    if (st === 'SUCCEEDED' && run.defaultDatasetId) {
      datasetIds.push(run.defaultDatasetId)
    }
  }

  const total = ids.length
  const terminal = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'])
  const done = statuses.filter((s) => terminal.has(s)).length
  const failed = statuses.filter((s) =>
    ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(s),
  ).length
  const allDone = done === total

  if (!allDone) {
    return { status: 'RUNNING', done, total }
  }
  if (failed === total) {
    return { status: 'FAILED', done, total }
  }

  const items: Vacancy[] = []
  const seen = new Set<string>()
  for (const datasetId of datasetIds) {
    const dataset = client.dataset(datasetId)
    let offset = 0
    const limit = 100
    for (;;) {
      const page = await dataset.listItems({ offset, limit })
      const batch = page.items || []
      for (const raw of batch) {
        const v = normalizeVacancy(raw as Record<string, unknown>)
        if (!v || seen.has(v.vacancyId)) continue
        seen.add(v.vacancyId)
        items.push(v)
      }
      if (batch.length < limit) break
      offset += batch.length
      if (offset > 2000) break
    }
  }

  return { status: 'SUCCEEDED', items, done, total }
}
