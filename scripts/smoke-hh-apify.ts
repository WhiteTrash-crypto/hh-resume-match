/**
 * Smoke: Apify collect (small budget).
 *
 *   npm run smoke:hh:apify
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  advanceHhCollect,
  emptyCollectProgress,
  planHhCollect,
} from '../shared/hh.ts'

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

function argLimit(): number {
  const i = process.argv.indexOf('--limit')
  if (i >= 0) return Number(process.argv[i + 1]) || 20
  return 20
}

async function main() {
  loadDotEnv()
  process.env.HH_SCRAPE_MODE = 'apify'

  const limit = argLimit()
  const plan = planHhCollect({
    query: 'менеджер',
    regions: 'Москва',
    remoteOnly: true,
    periodDays: 7,
    vacancyBudget: limit,
  })

  console.log('mode: apify')
  console.log('token:', (process.env.APIFY_TOKEN || '').trim() ? 'set' : 'MISSING')
  console.log('actor:', process.env.APIFY_ACTOR || 'abotapi/hh-ru-jobs-scraper')
  console.log('budget:', plan.vacancyBudget, 'pages:', plan.pagesPerQuery)

  let progress = emptyCollectProgress()
  const t0 = Date.now()
  let polls = 0
  while (progress.phase !== 'done') {
    polls++
    progress = await advanceHhCollect(plan, progress)
    console.log(
      `poll ${polls}: phase=${progress.phase} run=${progress.apifyRunId || '—'} items=${progress.items.length}`,
    )
    if (progress.phase !== 'done') {
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (polls > 60) throw new Error('Apify smoke timed out after 60 polls')
  }

  console.log(
    JSON.stringify(
      {
        items: progress.items.length,
        sample: progress.items.slice(0, 3).map((v) => ({
          id: v.vacancyId,
          title: v.title,
          hasContent: v.content.length > 50,
        })),
        ms: Date.now() - t0,
        polls,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
