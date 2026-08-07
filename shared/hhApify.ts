/**
 * Apify-backed HH vacancy collect (production path for Netlify).
 * Actor: APIFY_ACTOR (default abotapi/hh-ru-jobs-scraper)
 *
 * One actor run per search key (same pattern as earlier working prod runs).
 * maxListings: 0 = unlimited — volume is controlled by maxPages (50 items/page).
 */

import { ApifyClient } from 'apify-client'
import { buildSearchUrl, normalizeVacancy, type HhCollectPlan } from './hh.ts'
import type { Vacancy } from './types.ts'

function requireToken(): string {
  const token = (process.env.APIFY_TOKEN || '').trim()
  if (!token) throw new Error('APIFY_TOKEN не задан')
  return token
}

function actorId(): string {
  return (process.env.APIFY_ACTOR || 'abotapi/hh-ru-jobs-scraper').trim()
}

function client(): ApifyClient {
  return new ApifyClient({ token: requireToken() })
}

export function planSearchUrls(plan: HhCollectPlan): string[] {
  return plan.queries.map((query) =>
    buildSearchUrl({
      query,
      remoteOnly: plan.remoteOnly,
      periodDays: plan.periodDays,
      areaIds: plan.areaIds,
      page: 0,
    }),
  )
}

function buildRunInput(opts: {
  url: string
  maxPages: number
}): Record<string, unknown> {
  return {
    mode: 'url',
    urls: [opts.url],
    // Per actor docs: maxPages is per URL; 50 listings/page on hh.ru
    maxPages: Math.max(1, Math.min(40, opts.maxPages)),
    // 0 = unlimited (capped only by maxPages). A positive cap caused short runs.
    maxListings: 0,
    fetchDetails: true,
  }
}

/** Start one Apify run per search key. */
export async function startApifyCollect(plan: HhCollectPlan): Promise<{ runIds: string[] }> {
  const urls = planSearchUrls(plan)
  if (!urls.length) throw new Error('Нет поисковых URL для Apify')

  const apify = client()
  const actor = apify.actor(actorId())
  const runIds: string[] = []

  for (let i = 0; i < urls.length; i++) {
    const maxPages = plan.pagesPerQuery[i] || 1
    const input = buildRunInput({ url: urls[i], maxPages })
    console.log(
      'apify start',
      JSON.stringify({
        i,
        query: plan.queries[i],
        maxPages: input.maxPages,
        allotment: plan.vacanciesPerQuery[i],
        url: urls[i],
      }),
    )
    const run = await actor.start(input)
    if (!run?.id) throw new Error(`Не удалось запустить Apify для ключа «${plan.queries[i]}»`)
    runIds.push(run.id)
  }

  return { runIds }
}

async function readDatasetItems(
  apify: ApifyClient,
  datasetId: string,
): Promise<Vacancy[]> {
  const items: Vacancy[] = []
  const seen = new Set<string>()
  const dataset = apify.dataset(datasetId)
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
    if (offset > 5000) break
  }
  return items
}

/** Poll all runs; return items only when every run SUCCEEDED. */
export async function pollApifyCollect(runIds: string[]): Promise<{
  status: string
  items?: Vacancy[]
  doneCount: number
  total: number
}> {
  if (!runIds.length) return { status: 'SUCCEEDED', items: [], doneCount: 0, total: 0 }

  const apify = client()
  const statuses: string[] = []
  const datasetIds: (string | null)[] = []

  for (const runId of runIds) {
    const run = await apify.run(runId).get()
    if (!run) {
      statuses.push('UNKNOWN')
      datasetIds.push(null)
      continue
    }
    const status = String(run.status || 'UNKNOWN')
    statuses.push(status)
    datasetIds.push(run.defaultDatasetId || null)
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${runId} → ${status}`)
    }
  }

  const doneCount = statuses.filter((s) => s === 'SUCCEEDED').length
  const allDone = doneCount === runIds.length
  if (!allDone) {
    return { status: 'RUNNING', doneCount, total: runIds.length }
  }

  const merged: Vacancy[] = []
  const seen = new Set<string>()
  for (const datasetId of datasetIds) {
    if (!datasetId) continue
    const batch = await readDatasetItems(apify, datasetId)
    for (const v of batch) {
      if (seen.has(v.vacancyId)) continue
      seen.add(v.vacancyId)
      merged.push(v)
    }
  }

  return { status: 'SUCCEEDED', items: merged, doneCount, total: runIds.length }
}
