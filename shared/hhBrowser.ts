/**
 * Browser-based HH SERP collection (Playwright).
 * Used when HH_SCRAPE_MODE=browser — fetch SSR is soft-throttled (~20 cards/page).
 */

import { chromium, type Browser } from 'playwright'
import {
  buildSearchUrl,
  parseHhSearchCards,
  type HhCollectPlan,
} from './hh.ts'

export type BrowserSearchCard = {
  id: string
  title: string
  employer: string
  location: string
  salary: string
  snippet: string
  url: string
}

function proxyFromEnv():
  | { server: string; username?: string; password?: string }
  | undefined {
  const raw = (process.env.HH_PROXY || '').trim()
  if (!raw) return undefined
  const u = new URL(raw)
  const server = `${u.protocol}//${u.host}`
  const username = u.username ? decodeURIComponent(u.username) : undefined
  const password = u.password ? decodeURIComponent(u.password) : undefined
  return username ? { server, username, password } : { server }
}

function assertNotVpn(url: string, html: string): void {
  if (/\/vpnche{1,2}ck/i.test(url) || /VPN мешает работе сайта/i.test(html)) {
    throw new Error(
      'hh.ru показал VPN-check в браузере. Нужен другой HH_PROXY (лучше RU residential).',
    )
  }
}

async function cardsFromPage(
  // Playwright Page — keep untyped import surface narrow for Netlify bundling edge cases
  page: {
    content: () => Promise<string>
    url: () => string
    $$eval: (
      selector: string,
      fn: (nodes: Element[]) => BrowserSearchCard[],
    ) => Promise<BrowserSearchCard[]>
  },
): Promise<BrowserSearchCard[]> {
  const html = await page.content()
  assertNotVpn(page.url(), html)

  const parsed = parseHhSearchCards(html)
  if (parsed.length) return parsed

  return page.$$eval('[data-qa="vacancy-serp__vacancy"]', (nodes) => {
    const out: BrowserSearchCard[] = []
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
        node
          .querySelector('[data-qa="vacancy-serp__vacancy-employer-text"]')
          ?.textContent?.trim() ||
        node.querySelector('[data-qa="vacancy-serp__vacancy-employer"]')?.textContent?.trim() ||
        ''
      const location =
        node.querySelector('[data-qa="vacancy-serp__vacancy-address"]')?.textContent?.trim() ||
        ''
      out.push({
        id,
        title: (a.textContent || '').trim(),
        employer,
        location,
        salary: '',
        snippet: '',
        url: `https://hh.ru/vacancy/${id}`,
      })
    }
    return out
  })
}

/** Collect SERP cards with the same budget/pages plan as the fetch scraper. */
export async function collectSearchViaBrowser(
  plan: HhCollectPlan,
): Promise<{
  ids: string[]
  cards: Record<string, Record<string, unknown>>
}> {
  const proxy = proxyFromEnv()
  const ua = (process.env.HH_USER_AGENT || '').trim() || undefined

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({
      headless: true,
      proxy,
    })
    const context = await browser.newContext({
      locale: 'ru-RU',
      userAgent: ua,
      viewport: { width: 1440, height: 900 },
    })
    const page = await context.newPage()

    const seen = new Set<string>()
    const ids: string[] = []
    const cards: Record<string, Record<string, unknown>> = {}

    for (let qi = 0; qi < plan.queries.length; qi++) {
      const query = plan.queries[qi]
      const pages = plan.pagesPerQuery[qi]
      const allotment = plan.vacanciesPerQuery[qi]
      if (pages <= 0 || allotment <= 0) continue

      let taken = 0
      for (let p = 0; p < pages; p++) {
        if (taken >= allotment) break
        const url = buildSearchUrl({
          query,
          remoteOnly: plan.remoteOnly,
          periodDays: plan.periodDays,
          areaIds: plan.areaIds,
          page: p,
        })
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await new Promise((r) => setTimeout(r, 700))
        await Promise.race([
          page.waitForSelector('[data-qa="vacancy-serp__vacancy"]', { timeout: 15_000 }),
          page.waitForSelector('[data-qa="vacancies-not-found"]', { timeout: 15_000 }),
          page.waitForSelector('text=VPN мешает', { timeout: 15_000 }),
        ]).catch(() => undefined)

        const pageCards = await cardsFromPage(page)
        for (const card of pageCards) {
          if (taken >= allotment) break
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
          taken++
        }
        if (!pageCards.length) break
      }
    }

    const cappedIds = ids.slice(0, plan.vacancyBudget)
    const cappedCards: Record<string, Record<string, unknown>> = {}
    for (const id of cappedIds) cappedCards[id] = cards[id]
    return { ids: cappedIds, cards: cappedCards }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
