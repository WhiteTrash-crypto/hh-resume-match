import {
  distributeVacancyBudget,
  pagesForVacancyAllotment,
  vacancyBudgetForKeyCount,
  ITEMS_PER_PAGE,
} from './budget'
import { resolveRegions } from './regions'
import type { Vacancy } from './types'

/**
 * Collect vacancies by scraping public hh.ru HTML (same pages Apify hit).
 *
 * api.hh.ru returns bare 403 `forbidden` to programmatic clients (edge anti-bot).
 * The website still SSR-renders search results — unless the egress IP is flagged
 * as VPN/proxy (redirect to /vpncheeck). Optional HH_PROXY (HTTP(S) URL) routes
 * only HH fetches through a residential/RU proxy.
 */

const HH_SITE = 'https://hh.ru'
const UA =
  process.env.HH_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const DETAIL_BATCH = 8
const SEARCH_CONCURRENCY = 2
const ZWSP = /[\u200B-\u200F\u2060\uFEFF]/g

export type HhCollectPlan = {
  queries: string[]
  pagesPerQuery: number[]
  vacanciesPerQuery: number[]
  vacancyBudget: number
  areaIds: string[]
  regionsResolved: { input: string; id: string; name: string }[]
  remoteOnly: boolean
  periodDays: number
}

export type HhCollectProgress = {
  phase: 'search' | 'details' | 'done'
  ids: string[]
  cards: Record<string, Record<string, unknown>>
  detailsDone: number
  items: Vacancy[]
}

type FetchInit = RequestInit & { dispatcher?: unknown }

let proxyDispatcher: unknown | null | undefined

async function getProxyDispatcher(): Promise<unknown | undefined> {
  if (proxyDispatcher !== undefined) return proxyDispatcher || undefined
  const proxyUrl = (process.env.HH_PROXY || '').trim()
  if (!proxyUrl) {
    proxyDispatcher = null
    return undefined
  }
  try {
    const undici = await import('undici')
    proxyDispatcher = new undici.ProxyAgent(proxyUrl)
    return proxyDispatcher
  } catch (e) {
    throw new Error(
      `HH_PROXY задан, но undici недоступен: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

async function hhFetch(url: string): Promise<Response> {
  const dispatcher = await getProxyDispatcher()
  const init: FetchInit = {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  }
  if (dispatcher) init.dispatcher = dispatcher
  return fetch(url, init as RequestInit)
}

function assertNotVpnBlocked(res: Response, html: string): void {
  const finalUrl = res.url || ''
  if (/\/vpnche{1,2}ck/i.test(finalUrl) || /VPN мешает работе сайта/i.test(html)) {
    throw new Error(
      'hh.ru показал VPN-check для IP сервера. ' +
        'Нужен российский residential-прокси в HH_PROXY (http://user:pass@host:port), ' +
        'либо сбор с домашнего RU IP. Apify как раз обходит это через свои прокси.',
    )
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(ZWSP, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function qaText(block: string, qa: string): string {
  const m = block.match(
    new RegExp(`data-qa="${qa}[^"]*"[^>]*>([\\s\\S]*?)</(?:a|span|div)>`),
  )
  return m ? stripTags(m[1]) : ''
}

function extractSalary(block: string): string {
  const m = block.match(
    /(?:от|до)?\s?[\d\u00A0\u202F ]{4,}(?:\s?[–—-]\s?[\d\u00A0\u202F ]{4,})?\s?(?:₽|руб|€|\$|USD|EUR|KZT|BYN)/i,
  )
  return m ? stripTags(m[0]) : ''
}

/** Parse vacancy cards from hh.ru search HTML. */
export function parseHhSearchCards(html: string): Array<{
  id: string
  title: string
  employer: string
  location: string
  salary: string
  snippet: string
  url: string
}> {
  if (!html) return []
  const out: Array<{
    id: string
    title: string
    employer: string
    location: string
    salary: string
    snippet: string
    url: string
  }> = []
  const seen = new Set<string>()
  const blocks = html.split('data-qa="vacancy-serp__vacancy"').slice(1)

  for (const b of blocks) {
    const tm = b.match(
      /data-qa="serp-item__title[^"]*"[^>]*href="((?:https?:)?\/\/(?:[a-z0-9-]+\.)?hh\.ru\/vacancy\/(\d+)[^"]*)"[\s\S]*?>([\s\S]*?)<\/a>/,
    )
    if (!tm) continue
    const id = tm[2]
    if (seen.has(id)) continue
    seen.add(id)
    const title = stripTags(tm[3])
    if (!title) continue
    const responsibility = qaText(b, 'vacancy-serp__vacancy_snippet_responsibility')
    const requirement = qaText(b, 'vacancy-serp__vacancy_snippet_requirement')
    out.push({
      id,
      title,
      employer:
        qaText(b, 'vacancy-serp__vacancy-employer-text') ||
        qaText(b, 'vacancy-serp__vacancy-employer'),
      location: qaText(b, 'vacancy-serp__vacancy-address'),
      salary: extractSalary(b),
      snippet: [requirement, responsibility].filter(Boolean).join(' '),
      url: `https://hh.ru/vacancy/${id}`,
    })
  }
  return out
}

function parseVacancyDetailHtml(html: string, id: string): Record<string, unknown> {
  const raw: Record<string, unknown> = { id }

  const title =
    qaText(html, 'vacancy-title') ||
    (() => {
      const m = html.match(/<h1[^>]*data-qa="[^"]*vacancy[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
      return m ? stripTags(m[1]) : ''
    })()
  if (title) raw.name = title

  const descMatch =
    html.match(/data-qa="vacancy-description"[^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/data-qa="vacancy-description"[^>]*>([\s\S]*?)<\/section>/i)
  if (descMatch) raw.description = descMatch[1]

  const employer =
    qaText(html, 'vacancy-company-name') || qaText(html, 'bloko-header-2')
  if (employer) raw.employer = { name: employer }

  const experience = qaText(html, 'vacancy-experience') || qaText(html, 'work-experience-text')
  if (experience) raw.experience = { name: experience }

  const schedule = qaText(html, 'vacancy-view-employment-mode') || qaText(html, 'common--work-schedule')
  if (schedule) raw.schedule = { name: schedule }

  const salary = qaText(html, 'vacancy-salary') || qaText(html, 'vacancy-salary-compensation')
  if (salary) raw.salaryText = salary

  // JSON-LD JobPosting fallback
  const ldBlocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const m of ldBlocks) {
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>
      const job =
        data['@type'] === 'JobPosting'
          ? data
          : Array.isArray(data['@graph'])
            ? (data['@graph'] as Record<string, unknown>[]).find((g) => g['@type'] === 'JobPosting')
            : null
      if (!job) continue
      if (!raw.name && job.title) raw.name = String(job.title)
      if (!raw.description && job.description) raw.description = String(job.description)
      if (!raw.employer && job.hiringOrganization) {
        const org = job.hiringOrganization as { name?: string }
        if (org.name) raw.employer = { name: org.name }
      }
      break
    } catch {
      /* ignore bad json-ld */
    }
  }

  raw.alternate_url = `https://hh.ru/vacancy/${id}`
  return raw
}

function buildSearchUrl(opts: {
  query: string
  remoteOnly: boolean
  periodDays: number
  areaIds: string[]
  page: number
}): string {
  const params = new URLSearchParams()
  params.set('text', opts.query)
  params.set(
    'search_period',
    String(Math.min(30, Math.max(1, opts.periodDays))),
  )
  params.set('order_by', 'publication_time')
  params.set('items_on_page', String(ITEMS_PER_PAGE))
  params.set('page', String(opts.page))
  const areas = [...new Set(opts.areaIds.filter(Boolean))]
  for (const area of areas) params.append('area', area)
  if (opts.remoteOnly) params.append('schedule', 'remote')
  return `${HH_SITE}/search/vacancy?${params.toString()}`
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
    typeof area === 'object' && area
      ? area.name || ''
      : String(area || item.location || '')

  const salary = String(item.salaryText || item.salary || '')
  const experience =
    typeof item.experience === 'object' && item.experience
      ? String((item.experience as { name?: string }).name || '')
      : String(item.experience || '')
  const schedule =
    typeof item.schedule === 'object' && item.schedule
      ? String((item.schedule as { name?: string }).name || '')
      : String(item.schedule || '')

  const description = stripTags(String(item.descriptionText || item.description || ''))
  const snippet = stripTags(String(item.snippet || '')) || description.slice(0, 280)

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

export function emptyCollectProgress(): HhCollectProgress {
  return { phase: 'search', ids: [], cards: {}, detailsDone: 0, items: [] }
}

/** Validate inputs and build a collect plan (no network). */
export function planHhCollect(opts: {
  query: string
  remoteOnly: boolean
  periodDays: number
  regions?: string
  vacancyBudget?: number
}): HhCollectPlan {
  const queries = parseSearchQueries(opts.query)
  if (!queries.length) throw new Error('Укажите хотя бы один поисковый ключ')

  const regionResult = resolveRegions(opts.regions || '')
  if ((opts.regions || '').trim() && regionResult.unresolved.length) {
    throw new Error(
      `Не удалось распознать регион(ы): ${regionResult.unresolved.join(', ')}. ` +
        'Примеры: Москва, СПб, Алматы, Минск, Казахстан, ОАЭ, Польша',
    )
  }
  if ((opts.regions || '').trim() && !regionResult.areaIds.length) {
    throw new Error(
      'Укажите хотя бы один понятный регион/страну или оставьте поле пустым (без фильтра по гео)',
    )
  }
  const areaIds = regionResult.areaIds

  const vacancyBudget =
    opts.vacancyBudget && opts.vacancyBudget > 0
      ? Math.floor(opts.vacancyBudget)
      : vacancyBudgetForKeyCount(queries.length)
  const vacanciesPerQuery = distributeVacancyBudget(vacancyBudget, queries.length)
  const pagesPerQuery = vacanciesPerQuery.map(pagesForVacancyAllotment)

  if (!pagesPerQuery.some((p) => p > 0)) {
    throw new Error('Бюджет страниц слишком мал для выбранных ключей')
  }

  return {
    queries,
    pagesPerQuery,
    vacanciesPerQuery,
    vacancyBudget,
    areaIds,
    regionsResolved: regionResult.resolved,
    remoteOnly: opts.remoteOnly,
    periodDays: opts.periodDays,
  }
}

async function fetchSearchPage(
  query: string,
  plan: HhCollectPlan,
  page: number,
): Promise<ReturnType<typeof parseHhSearchCards>> {
  const url = buildSearchUrl({
    query,
    remoteOnly: plan.remoteOnly,
    periodDays: plan.periodDays,
    areaIds: plan.areaIds,
    page,
  })
  const res = await hhFetch(url)
  const html = await res.text()
  assertNotVpnBlocked(res, html)
  if (!res.ok) {
    throw new Error(`hh.ru search HTTP ${res.status}`)
  }
  return parseHhSearchCards(html)
}

async function fetchVacancyDetail(id: string): Promise<Record<string, unknown>> {
  const res = await hhFetch(`${HH_SITE}/vacancy/${id}`)
  const html = await res.text()
  assertNotVpnBlocked(res, html)
  if (!res.ok) {
    throw new Error(`hh.ru vacancy ${id} HTTP ${res.status}`)
  }
  return parseVacancyDetailHtml(html, id)
}

/**
 * Advance collection by one poll slice: all search pages, then a batch of details.
 * Safe for Netlify timeouts — call repeatedly until phase === 'done'.
 */
export async function advanceHhCollect(
  plan: HhCollectPlan,
  progress: HhCollectProgress,
): Promise<HhCollectProgress> {
  if (progress.phase === 'done') return progress

  if (progress.phase === 'search') {
    const seen = new Set(progress.ids)
    const cards = { ...progress.cards }
    const ids = [...progress.ids]
    const perQueryCount = new Map<string, number>()

    const jobs: { query: string; page: number; allotment: number }[] = []
    for (let qi = 0; qi < plan.queries.length; qi++) {
      const pages = plan.pagesPerQuery[qi]
      const allotment = plan.vacanciesPerQuery[qi]
      if (pages <= 0 || allotment <= 0) continue
      for (let p = 0; p < pages; p++) {
        jobs.push({ query: plan.queries[qi], page: p, allotment })
      }
    }

    for (let i = 0; i < jobs.length; i += SEARCH_CONCURRENCY) {
      const chunk = jobs.slice(i, i + SEARCH_CONCURRENCY)
      const pages = await Promise.all(
        chunk.map((j) => fetchSearchPage(j.query, plan, j.page)),
      )
      for (let j = 0; j < chunk.length; j++) {
        const job = chunk[j]
        const cardsOnPage = pages[j]
        for (const card of cardsOnPage) {
          if ((perQueryCount.get(job.query) || 0) >= job.allotment) break
          if (seen.has(card.id)) continue
          seen.add(card.id)
          ids.push(card.id)
          cards[card.id] = {
            id: card.id,
            name: card.title,
            title: card.title,
            employer: { name: card.employer },
            location: card.location,
            salaryText: card.salary,
            snippet: card.snippet,
            alternate_url: card.url,
          }
          perQueryCount.set(job.query, (perQueryCount.get(job.query) || 0) + 1)
        }
      }
    }

    const cappedIds = ids.slice(0, plan.vacancyBudget)
    const cappedCards: Record<string, Record<string, unknown>> = {}
    for (const id of cappedIds) cappedCards[id] = cards[id]

    return {
      phase: 'details',
      ids: cappedIds,
      cards: cappedCards,
      detailsDone: 0,
      items: [],
    }
  }

  const start = progress.detailsDone
  const end = Math.min(start + DETAIL_BATCH, progress.ids.length)
  const batchIds = progress.ids.slice(start, end)
  const items = [...progress.items]

  const details = await Promise.all(
    batchIds.map(async (id) => {
      try {
        return await fetchVacancyDetail(id)
      } catch {
        return progress.cards[id] || { id }
      }
    }),
  )

  for (let i = 0; i < details.length; i++) {
    const id = batchIds[i]
    const merged = { ...(progress.cards[id] || {}), ...details[i] }
    const v = normalizeVacancy(merged)
    if (v) items.push(v)
  }

  const detailsDone = end
  const done = detailsDone >= progress.ids.length
  return {
    phase: done ? 'done' : 'details',
    ids: progress.ids,
    cards: progress.cards,
    detailsDone,
    items,
  }
}

export function collectProgressLabel(progress: HhCollectProgress): string {
  if (progress.phase === 'search') return 'Поиск вакансий на hh.ru…'
  if (progress.phase === 'details') {
    return `Загрузка описаний ${progress.detailsDone}/${progress.ids.length}`
  }
  return `Собрано ${progress.items.length} вакансий`
}

/** Lightweight probe for staging / health checks. */
export async function probeHhAccess(): Promise<{
  ok: boolean
  cards: number
  finalUrl: string
  proxy: boolean
  error?: string
}> {
  const proxy = Boolean((process.env.HH_PROXY || '').trim())
  try {
    const url = buildSearchUrl({
      query: 'менеджер',
      remoteOnly: true,
      periodDays: 7,
      areaIds: [],
      page: 0,
    })
    const res = await hhFetch(url)
    const html = await res.text()
    assertNotVpnBlocked(res, html)
    if (!res.ok) {
      return { ok: false, cards: 0, finalUrl: res.url, proxy, error: `HTTP ${res.status}` }
    }
    const cards = parseHhSearchCards(html).length
    return { ok: cards > 0, cards, finalUrl: res.url, proxy }
  } catch (e) {
    return {
      ok: false,
      cards: 0,
      finalUrl: '',
      proxy,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
