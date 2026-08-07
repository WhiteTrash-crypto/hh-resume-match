/**
 * Smoke: product collect search phase with HH_SCRAPE_MODE=browser + HH_PROXY.
 *
 *   npm run smoke:hh:browser
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

async function main() {
  loadDotEnv()
  process.env.HH_SCRAPE_MODE = process.env.HH_SCRAPE_MODE || 'browser'

  const limit = Number(process.argv.find((a, i, arr) => arr[i - 1] === '--limit') || 50)
  const plan = planHhCollect({
    query: 'менеджер',
    regions: 'Москва',
    remoteOnly: true,
    periodDays: 7,
    vacancyBudget: limit,
  })

  console.log('mode:', process.env.HH_SCRAPE_MODE)
  console.log('proxy:', (process.env.HH_PROXY || '').trim() ? 'set' : 'NOT set')
  console.log('plan pages:', plan.pagesPerQuery, 'budget:', plan.vacancyBudget)

  const t0 = Date.now()
  const progress = await advanceHhCollect(plan, emptyCollectProgress())
  console.log(
    JSON.stringify(
      {
        phase: progress.phase,
        ids: progress.ids.length,
        sample: progress.ids.slice(0, 5),
        ms: Date.now() - t0,
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
