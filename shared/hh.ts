import { ApifyClient } from 'apify-client'
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
}): string {
  const params = new URLSearchParams()
  params.set('text', opts.query)
  params.set('search_period', String(opts.periodDays))
  params.set('order_by', 'publication_time')
  params.set('items_on_page', '50')
  params.append('area', '113')
  params.append('professional_role', '73')
  params.append('professional_role', '107')
  params.append('experience', 'between1And3')
  params.append('experience', 'between3And6')
  if (opts.remoteOnly) params.append('schedule', 'remote')
  return `https://hh.ru/search/vacancy?${params.toString()}`
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
  maxPages: number
}): Promise<{ runId: string }> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN не задан')
  const actor = process.env.APIFY_ACTOR
  if (!actor) throw new Error('APIFY_ACTOR не задан')
  const client = new ApifyClient({ token })
  const searchUrl = buildSearchUrl(opts)
  const run = await client.actor(actor).start({
    mode: 'url',
    urls: [searchUrl],
    maxPages: opts.maxPages,
    fetchDetails: true,
  })
  if (!run?.id) throw new Error('Не удалось запустить Apify')
  return { runId: run.id }
}

export async function getHhCollectStatus(runId: string): Promise<{
  status: string
  items?: Vacancy[]
}> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN не задан')
  const client = new ApifyClient({ token })
  const run = await client.run(runId).get()
  if (!run) return { status: 'UNKNOWN' }
  const status = String(run.status || 'UNKNOWN')
  if (status !== 'SUCCEEDED') return { status }

  const datasetId = run.defaultDatasetId
  if (!datasetId) return { status, items: [] }
  const items: Vacancy[] = []
  const seen = new Set<string>()
  for await (const raw of client.dataset(datasetId).iterateItems()) {
    const v = normalizeVacancy(raw as Record<string, unknown>)
    if (!v || seen.has(v.vacancyId)) continue
    seen.add(v.vacancyId)
    items.push(v)
  }
  return { status, items }
}
