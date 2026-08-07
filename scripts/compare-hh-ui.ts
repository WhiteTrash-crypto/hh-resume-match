/**
 * Compare vacancy IDs: our server HTML scrape vs the same SERP in a real browser (Playwright).
 *
 * Usage:
 *   npm run compare:hh -- --query "менеджер" --regions Москва --period 7 --limit 100
 *   npm run compare:hh -- --query "менеджер" --no-remote --headed
 *
 * Env (.env):
 *   HH_PROXY       optional HTTP(S) proxy for both sides (product scrape + Playwright)
 *   HH_USER_AGENT  optional UA for product scrape (browser uses Chromium default unless set)
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import {
  advanceHhCollect,
  buildSearchUrl,
  emptyCollectProgress,
  parseHhSearchCards,
  planHhCollect,
  type HhCollectPlan,
} from '../shared/hh.ts'
import { ITEMS_PER_PAGE } from '../shared/budget.ts'

type Card = {
  id: string
  title: string
  employer: string
  url: string
  source: 'scrape' | 'browser'
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

function proxyForPlaywright(): { server: string; username?: string; password?: string } | undefined {
  const raw = (process.env.HH_PROXY || '').trim()
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    const server = `${u.protocol}//${u.host}`
    const username = u.username ? decodeURIComponent(u.username) : undefined
    const password = u.password ? decodeURIComponent(u.password) : undefined
    return username ? { server, username, password } : { server }
  } catch {
    throw new Error(`HH_PROXY is not a valid URL: ${raw}`)
  }
}

function assertNotVpn(url: string, html: string): void {
  if (/\/vpnche{1,2}ck/i.test(url) || /VPN мешает работе сайта/i.test(html)) {
    throw new Error(
      'hh.ru показал VPN-check в браузере. Нужен RU IP или HH_PROXY (residential).',
    )
  }
}

async function collectFromScrape(opts: {
  query: string
  regions: string
  remoteOnly: boolean
  periodDays: number
  limit: number
}): Promise<{ cards: Card[]; plan: HhCollectPlan }> {
  const plan = planHhCollect({
    query: opts.query,
    regions: opts.regions,
    remoteOnly: opts.remoteOnly,
    periodDays: opts.periodDays,
    vacancyBudget: opts.limit,
  })
  let progress = emptyCollectProgress()
  progress = await advanceHhCollect(plan, progress)
  if (progress.phase === 'search') {
    throw new Error('HTML scrape search did not finish in one slice (unexpected)')
  }
  const cards: Card[] = progress.ids.map((id) => {
    const c = progress.cards[id] || {}
    const employer = c.employer as { name?: string } | undefined
    return {
      id,
      title: String(c.name || c.title || ''),
      employer: employer?.name || '',
      url: String(c.alternate_url || `https://hh.ru/vacancy/${id}`),
      source: 'scrape' as const,
    }
  })
  return { cards, plan }
}

async function extractCardsFromPage(page: Page): Promise<Card[]> {
  const html = await page.content()
  assertNotVpn(page.url(), html)

  // Prefer the same parser as production — diffs then mean different HTML, not selector drift.
  const parsed = parseHhSearchCards(html).map((c) => ({
    id: c.id,
    title: c.title,
    employer: c.employer,
    url: c.url,
    source: 'browser' as const,
  }))
  if (parsed.length) return parsed

  // Fallback: live DOM (SPA / markup change)
  const fromDom = await page.$$eval(
    '[data-qa="vacancy-serp__vacancy"]',
    (nodes) => {
      const out: { id: string; title: string; employer: string; url: string }[] = []
      const seen = new Set<string>()
      for (const node of nodes) {
        const a =
          node.querySelector<HTMLAnchorElement>('a[data-qa="serp-item__title"]') ||
          node.querySelector<HTMLAnchorElement>('a[href*="/vacancy/"]')
        if (!a?.href) continue
        const m = a.href.match(/\/vacancy\/(\d+)/)
        if (!m) continue
        const id = m[1]
        if (seen.has(id)) continue
        seen.add(id)
        const employer =
          node.querySelector('[data-qa="vacancy-serp__vacancy-employer-text"]')?.textContent?.trim() ||
          node.querySelector('[data-qa="vacancy-serp__vacancy-employer"]')?.textContent?.trim() ||
          ''
        out.push({
          id,
          title: (a.textContent || '').trim(),
          employer,
          url: `https://hh.ru/vacancy/${id}`,
        })
      }
      return out
    },
  )
  return fromDom.map((c) => ({ ...c, source: 'browser' as const }))
}

async function collectFromBrowser(opts: {
  plan: HhCollectPlan
  headed: boolean
  slowMo: number
}): Promise<{ cards: Card[]; pagesFetched: number; urls: string[] }> {
  const proxy = proxyForPlaywright()
  const browser: Browser = await chromium.launch({
    headless: !opts.headed,
    slowMo: opts.slowMo || 0,
    proxy,
  })
  const context = await browser.newContext({
    locale: 'ru-RU',
    userAgent: (process.env.HH_USER_AGENT || '').trim() || undefined,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  const cards: Card[] = []
  const seen = new Set<string>()
  const urls: string[] = []
  let pagesFetched = 0

  try {
    for (let qi = 0; qi < opts.plan.queries.length; qi++) {
      const query = opts.plan.queries[qi]
      const pages = opts.plan.pagesPerQuery[qi]
      const allotment = opts.plan.vacanciesPerQuery[qi]
      if (pages <= 0 || allotment <= 0) continue

      let takenForQuery = 0
      for (let p = 0; p < pages; p++) {
        if (takenForQuery >= allotment) break
        const url = buildSearchUrl({
          query,
          remoteOnly: opts.plan.remoteOnly,
          periodDays: opts.plan.periodDays,
          areaIds: opts.plan.areaIds,
          page: p,
        })
        urls.push(url)
        console.log(`  browser page ${pagesFetched + 1}: ${url}`)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await new Promise((r) => setTimeout(r, 800))
        // Wait for either cards or empty-state / captcha-ish content
        await Promise.race([
          page.waitForSelector('[data-qa="vacancy-serp__vacancy"]', { timeout: 15_000 }),
          page.waitForSelector('[data-qa="vacancies-not-found"]', { timeout: 15_000 }),
          page.waitForSelector('text=VPN мешает', { timeout: 15_000 }),
        ]).catch(() => undefined)

        const pageCards = await extractCardsFromPage(page)
        pagesFetched++
        for (const card of pageCards) {
          if (takenForQuery >= allotment) break
          if (seen.has(card.id)) continue
          seen.add(card.id)
          cards.push(card)
          takenForQuery++
        }
        if (!pageCards.length) break
      }
    }
  } finally {
    await browser.close()
  }

  return {
    cards: cards.slice(0, opts.plan.vacancyBudget),
    pagesFetched,
    urls,
  }
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
  const headed = hasFlag('headed')
  const slowMo = Number(arg('slowmo', '0')) || 0
  const outPath = arg('out', 'scripts/compare-hh-ui-result.json')

  console.log('Collecting via product scrape (fetch HTML)…')
  const scrape = await collectFromScrape({
    query,
    regions,
    remoteOnly,
    periodDays,
    limit,
  })
  console.log(`  scrape: ${scrape.cards.length} ids`)

  console.log('Collecting via Playwright (same search URLs)…')
  const browser = await collectFromBrowser({
    plan: scrape.plan,
    headed,
    slowMo,
  })
  console.log(`  browser: ${browser.cards.length} ids (${browser.pagesFetched} pages)`)

  const scrapeIds = new Set(scrape.cards.map((c) => c.id))
  const browserIds = new Set(browser.cards.map((c) => c.id))
  const onlyBrowser = diffSets(browserIds, scrapeIds)
  const onlyScrape = diffSets(scrapeIds, browserIds)
  const both = [...scrapeIds].filter((id) => browserIds.has(id))

  const byId = new Map<string, Card>()
  for (const c of [...scrape.cards, ...browser.cards]) {
    if (!byId.has(c.id)) byId.set(c.id, c)
  }

  const report = {
    time: new Date().toISOString(),
    params: {
      query,
      queries: scrape.plan.queries,
      regions,
      areaIds: scrape.plan.areaIds,
      remoteOnly,
      periodDays,
      limit,
      itemsOnPage: ITEMS_PER_PAGE,
      pagesPerQuery: scrape.plan.pagesPerQuery,
      proxy: Boolean((process.env.HH_PROXY || '').trim()),
    },
    urls: browser.urls,
    counts: {
      scrape: scrape.cards.length,
      browser: browser.cards.length,
      browserPages: browser.pagesFetched,
      intersection: both.length,
      onlyInBrowser: onlyBrowser.length,
      onlyInScrape: onlyScrape.length,
    },
    overlapRatio: {
      ofScrape: scrape.cards.length ? both.length / scrape.cards.length : 0,
      ofBrowser: browser.cards.length ? both.length / browser.cards.length : 0,
    },
    onlyInBrowser: onlyBrowser.map((id) => byId.get(id)),
    onlyInScrape: onlyScrape.map((id) => byId.get(id)),
  }

  await writeFile(resolve(process.cwd(), outPath), JSON.stringify(report, null, 2), 'utf8')

  console.log('\n=== Product scrape vs browser SERP ===')
  console.log(`queries: ${scrape.plan.queries.join(' | ')}`)
  console.log(`regions: ${regions || '(none)'} → areas [${scrape.plan.areaIds.join(', ') || '—'}]`)
  console.log(`remote: ${remoteOnly}, period: ${periodDays}d, limit: ${limit}`)
  console.log(`scrape:  ${report.counts.scrape}`)
  console.log(`browser: ${report.counts.browser}`)
  console.log(`intersection: ${both.length}`)
  console.log(`only in browser (UI has, we miss): ${onlyBrowser.length}`)
  console.log(`only in scrape  (we have, UI miss): ${onlyScrape.length}`)

  if (onlyBrowser.length) {
    console.log('\nSample only-in-browser (up to 10):')
    for (const id of onlyBrowser.slice(0, 10)) {
      const c = byId.get(id)
      console.log(`  ${id}  ${c?.title || ''}  ${c?.url || ''}`)
    }
  }
  if (onlyScrape.length) {
    console.log('\nSample only-in-scrape (up to 10):')
    for (const id of onlyScrape.slice(0, 10)) {
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
