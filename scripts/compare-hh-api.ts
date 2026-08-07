/**
 * Compare vacancy IDs: our hh.ru HTML scrape vs official api.hh.ru.
 *
 * Usage:
 *   npm run compare:hh -- --query "менеджер" --regions Москва --remote --period 7 --limit 100
 *
 * Env (.env):
 *   HH_API_ACCESS_TOKEN   app or user Bearer token (from https://dev.hh.ru/admin)
 *   HH_API_USER_AGENT     required, e.g. "MyApp/1.0 (you@email.com)" — must match registered app
 *   HH_CLIENT_ID / HH_CLIENT_SECRET  optional; used to mint app token if ACCESS_TOKEN empty
 *   HH_PROXY              optional; used for HTML side only (same as product)
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  advanceHhCollect,
  emptyCollectProgress,
  planHhCollect,
} from '../shared/hh.ts'
import { ITEMS_PER_PAGE } from '../shared/budget.ts'

type ApiItem = {
  id: string
  name?: string
  alternate_url?: string
  employer?: { name?: string }
  area?: { name?: string }
  published_at?: string
}

type ApiSearchResponse = {
  items?: ApiItem[]
  found?: number
  pages?: number
  page?: number
  per_page?: number
  errors?: unknown
  description?: string
}

type Card = {
  id: string
  title: string
  employer: string
  url: string
  source: 'html' | 'api'
}

function loadDotEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch {
    /* no .env */
  }
}

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  return process.argv[i + 1] || fallback
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function mintAppToken(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })
  const res = await fetch('https://hh.ru/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(
      `OAuth app token failed HTTP ${res.status}: ${json.error || json.error_description || JSON.stringify(json)}`,
    )
  }
  return json.access_token
}

async function resolveApiToken(): Promise<string> {
  const existing = (process.env.HH_API_ACCESS_TOKEN || '').trim()
  if (existing) return existing
  const id = (process.env.HH_CLIENT_ID || '').trim()
  const secret = (process.env.HH_CLIENT_SECRET || '').trim()
  if (!id || !secret) {
    throw new Error(
      'Нужен HH_API_ACCESS_TOKEN (с https://dev.hh.ru/admin) или пара HH_CLIENT_ID + HH_CLIENT_SECRET',
    )
  }
  return mintAppToken(id, secret)
}

function apiUserAgent(): string {
  const ua = (process.env.HH_API_USER_AGENT || '').trim()
  if (!ua) {
    throw new Error(
      'Задайте HH_API_USER_AGENT в формате "AppName/1.0 (you@email.com)" — как в приложении на dev.hh.ru',
    )
  }
  return ua
}

async function fetchApiPage(opts: {
  token: string
  ua: string
  query: string
  areaIds: string[]
  remoteOnly: boolean
  periodDays: number
  page: number
  perPage: number
}): Promise<ApiSearchResponse> {
  const params = new URLSearchParams()
  params.set('text', opts.query)
  params.set('period', String(Math.min(30, Math.max(1, opts.periodDays))))
  params.set('order_by', 'publication_time')
  params.set('per_page', String(opts.perPage))
  params.set('page', String(opts.page))
  for (const area of [...new Set(opts.areaIds.filter(Boolean))]) {
    params.append('area', area)
  }
  // Site scrape uses schedule=remote; API accepts the same dictionary id.
  if (opts.remoteOnly) params.append('schedule', 'remote')

  const url = `https://api.hh.ru/vacancies?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'User-Agent': opts.ua,
      'HH-User-Agent': opts.ua,
      Accept: 'application/json',
    },
  })
  const json = (await res.json()) as ApiSearchResponse
  if (!res.ok) {
    throw new Error(
      `api.hh.ru HTTP ${res.status}: ${json.description || JSON.stringify(json.errors || json)}`,
    )
  }
  return json
}

async function collectFromApi(opts: {
  token: string
  ua: string
  query: string
  areaIds: string[]
  remoteOnly: boolean
  periodDays: number
  limit: number
}): Promise<{ cards: Card[]; found: number; pagesFetched: number }> {
  const perPage = Math.min(100, Math.max(1, ITEMS_PER_PAGE))
  const cards: Card[] = []
  const seen = new Set<string>()
  let found = 0
  let pagesFetched = 0
  let page = 0
  let totalPages = 1

  while (cards.length < opts.limit && page < totalPages) {
    const data = await fetchApiPage({
      token: opts.token,
      ua: opts.ua,
      query: opts.query,
      areaIds: opts.areaIds,
      remoteOnly: opts.remoteOnly,
      periodDays: opts.periodDays,
      page,
      perPage,
    })
    found = data.found ?? found
    totalPages = data.pages ?? totalPages
    pagesFetched++
    for (const item of data.items || []) {
      const id = String(item.id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      cards.push({
        id,
        title: item.name || '',
        employer: item.employer?.name || '',
        url: item.alternate_url || `https://hh.ru/vacancy/${id}`,
        source: 'api',
      })
      if (cards.length >= opts.limit) break
    }
    if (!(data.items || []).length) break
    page++
  }

  return { cards, found, pagesFetched }
}

async function collectFromHtml(opts: {
  query: string
  regions: string
  remoteOnly: boolean
  periodDays: number
  limit: number
}): Promise<{ cards: Card[]; planQueries: string[]; areaIds: string[] }> {
  const plan = planHhCollect({
    query: opts.query,
    regions: opts.regions,
    remoteOnly: opts.remoteOnly,
    periodDays: opts.periodDays,
    vacancyBudget: opts.limit,
  })
  let progress = emptyCollectProgress()
  // One advance slice runs the full search phase (all pages), then returns details phase.
  progress = await advanceHhCollect(plan, progress)
  if (progress.phase === 'search') {
    throw new Error('HTML search did not finish in one slice (unexpected)')
  }
  const cards: Card[] = progress.ids.map((id) => {
    const c = progress.cards[id] || {}
    const employer = c.employer as { name?: string } | undefined
    return {
      id,
      title: String(c.name || c.title || ''),
      employer: employer?.name || '',
      url: String(c.alternate_url || `https://hh.ru/vacancy/${id}`),
      source: 'html' as const,
    }
  })
  return { cards, planQueries: plan.queries, areaIds: plan.areaIds }
}

function diffSets(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x))
}

async function main(): Promise<void> {
  loadDotEnv()

  const query = arg('query', 'менеджер')
  const regions = arg('regions', 'Москва')
  const periodDays = Number(arg('period', '7')) || 7
  const limit = Number(arg('limit', '100')) || 100
  const remoteOnly = !hasFlag('no-remote')
  const outPath = arg('out', `scripts/compare-hh-api-result.json`)

  console.log('Resolving API token…')
  const token = await resolveApiToken()
  const ua = apiUserAgent()

  console.log('Collecting HTML (product scrape)…')
  const html = await collectFromHtml({
    query,
    regions,
    remoteOnly,
    periodDays,
    limit,
  })

  // Compare one primary query (first key) against API with same filters.
  const primaryQuery = html.planQueries[0] || query
  console.log(`Collecting API for query="${primaryQuery}"…`)
  const api = await collectFromApi({
    token,
    ua,
    query: primaryQuery,
    areaIds: html.areaIds,
    remoteOnly,
    periodDays,
    limit,
  })

  const htmlIds = new Set(html.cards.map((c) => c.id))
  const apiIds = new Set(api.cards.map((c) => c.id))
  const onlyApi = diffSets(apiIds, htmlIds)
  const onlyHtml = diffSets(htmlIds, apiIds)
  const both = [...htmlIds].filter((id) => apiIds.has(id))

  const byId = new Map<string, Card>()
  for (const c of [...html.cards, ...api.cards]) {
    if (!byId.has(c.id)) byId.set(c.id, c)
  }

  const report = {
    time: new Date().toISOString(),
    params: {
      query: primaryQuery,
      allQueries: html.planQueries,
      regions,
      areaIds: html.areaIds,
      remoteOnly,
      periodDays,
      limit,
      htmlItemsOnPage: ITEMS_PER_PAGE,
    },
    counts: {
      html: html.cards.length,
      api: api.cards.length,
      apiFoundTotal: api.found,
      apiPagesFetched: api.pagesFetched,
      intersection: both.length,
      onlyInApi: onlyApi.length,
      onlyInHtml: onlyHtml.length,
    },
    overlapRatio: {
      ofHtml: html.cards.length ? both.length / html.cards.length : 0,
      ofApi: api.cards.length ? both.length / api.cards.length : 0,
    },
    onlyInApi: onlyApi.map((id) => byId.get(id)),
    onlyInHtml: onlyHtml.map((id) => byId.get(id)),
  }

  await writeFile(resolve(process.cwd(), outPath), JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== HTML (наш скрейп) vs api.hh.ru ===')
  console.log(`query: ${primaryQuery}`)
  console.log(`regions: ${regions || '(none)'} → areas [${html.areaIds.join(', ') || '—'}]`)
  console.log(`remote: ${remoteOnly}, period: ${periodDays}d, limit: ${limit}`)
  console.log(`HTML cards: ${report.counts.html}`)
  console.log(`API cards:  ${report.counts.api} (found=${api.found}, pages=${api.pagesFetched})`)
  console.log(`intersection: ${both.length}`)
  console.log(`only in API:  ${onlyApi.length}`)
  console.log(`only in HTML: ${onlyHtml.length}`)
  if (onlyApi.length) {
    console.log('\nSample only-in-API (up to 10):')
    for (const id of onlyApi.slice(0, 10)) {
      const c = byId.get(id)
      console.log(`  ${id}  ${c?.title || ''}  ${c?.url || ''}`)
    }
  }
  if (onlyHtml.length) {
    console.log('\nSample only-in-HTML (up to 10):')
    for (const id of onlyHtml.slice(0, 10)) {
      const c = byId.get(id)
      console.log(`  ${id}  ${c?.title || ''}  ${c?.url || ''}`)
    }
  }
  console.log(`\nFull report: ${outPath}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
