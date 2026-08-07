/**
 * Apify-backed HH vacancy collect (production path for Netlify).
 * Actor: APIFY_ACTOR (default abotapi/hh-ru-jobs-scraper)
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

/** Build one hh.ru search URL per query key (same params as HTML scrape). */
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

export async function startApifyCollect(plan: HhCollectPlan): Promise<{ runId: string }> {
  const urls = planSearchUrls(plan)
  if (!urls.length) throw new Error('Нет поисковых URL для Apify')

  const maxPages = Math.max(1, ...plan.pagesPerQuery.filter((p) => p > 0), 1)
  const maxListings = Math.max(1, plan.vacancyBudget)

  const run = await client()
    .actor(actorId())
    .start({
      mode: 'url',
      urls,
      maxPages,
      maxListings,
      fetchDetails: true,
    })

  if (!run?.id) throw new Error('Не удалось запустить Apify')
  return { runId: run.id }
}

export async function pollApifyCollect(runId: string): Promise<{
  status: string
  items?: Vacancy[]
}> {
  const apify = client()
  const run = await apify.run(runId).get()
  if (!run) return { status: 'UNKNOWN' }

  const status = String(run.status || 'UNKNOWN')
  if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
    throw new Error(`Apify run ${runId} → ${status}`)
  }
  if (status !== 'SUCCEEDED') return { status }

  const datasetId = run.defaultDatasetId
  if (!datasetId) return { status, items: [] }

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

  return { status, items }
}
