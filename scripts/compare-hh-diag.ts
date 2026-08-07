/**
 * Diagnose why product fetch sees fewer SERP cards than Playwright.
 * Saves HTML samples + counts under scripts/.diag/
 *
 *   npm run compare:hh:diag
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { buildSearchUrl, parseHhSearchCards } from '../shared/hh.ts'

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

const UA =
  process.env.HH_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function analyze(label: string, html: string, finalUrl: string) {
  const cards = parseHhSearchCards(html)
  const serpMarks = (html.match(/data-qa="vacancy-serp__vacancy"/g) || []).length
  const titleMarks = (html.match(/data-qa="serp-item__title/g) || []).length
  const vacancyLinks = (html.match(/\/vacancy\/\d+/g) || []).length
  return {
    label,
    finalUrl,
    bytes: Buffer.byteLength(html, 'utf8'),
    parsedCards: cards.length,
    serpMarks,
    titleMarks,
    vacancyLinks,
    hasVpn: /VPN мешает|\/vpnche{1,2}ck/i.test(html) || /\/vpnche{1,2}ck/i.test(finalUrl),
    hasCaptcha: /captcha|SmartCaptcha|я не робот/i.test(html),
    hasBot: /detected unusual traffic|подозрительн/i.test(html),
    hasNotFound: /vacancies-not-found|ничего не найдено/i.test(html),
    sampleIds: cards.slice(0, 5).map((c) => c.id),
  }
}

async function fetchRaw(url: string): Promise<{ html: string; finalUrl: string; status: number; headers: Record<string, string> }> {
  const proxyUrl = (process.env.HH_PROXY || '').trim()
  let dispatcher: unknown | undefined
  if (proxyUrl) {
    const undici = await import('undici')
    dispatcher = new undici.ProxyAgent(proxyUrl)
  }
  const init: RequestInit & { dispatcher?: unknown } = {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
    redirect: 'follow',
  }
  if (dispatcher) init.dispatcher = dispatcher
  const res = await fetch(url, init as RequestInit)
  const html = await res.text()
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  return { html, finalUrl: res.url, status: res.status, headers }
}

async function main() {
  loadDotEnv()
  const outDir = resolve(process.cwd(), 'scripts/.diag')
  await mkdir(outDir, { recursive: true })

  const url = buildSearchUrl({
    query: 'менеджер',
    remoteOnly: true,
    periodDays: 7,
    areaIds: ['1'],
    page: 0,
  })
  console.log('URL:', url)
  console.log('HH_PROXY:', (process.env.HH_PROXY || '').trim() ? 'set' : 'NOT set')

  console.log('\n1) Product-like fetch…')
  const fetched = await fetchRaw(url)
  const fetchStats = analyze('fetch', fetched.html, fetched.finalUrl)
  await writeFile(resolve(outDir, 'fetch.html'), fetched.html)
  console.log(JSON.stringify({ ...fetchStats, status: fetched.status, setCookie: fetched.headers['set-cookie']?.slice(0, 120) }, null, 2))

  console.log('\n2) Playwright browser…')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    locale: 'ru-RU',
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1500))
  const browserHtml = await page.content()
  const browserUrl = page.url()
  const browserStats = analyze('browser', browserHtml, browserUrl)
  await writeFile(resolve(outDir, 'browser.html'), browserHtml)
  console.log(JSON.stringify(browserStats, null, 2))

  // After JS settle: count live DOM cards
  const domCount = await page.locator('[data-qa="vacancy-serp__vacancy"]').count()
  console.log('DOM vacancy cards:', domCount)

  await browser.close()

  const report = {
    time: new Date().toISOString(),
    url,
    proxy: Boolean((process.env.HH_PROXY || '').trim()),
    fetch: { ...fetchStats, status: fetched.status },
    browser: browserStats,
    domCount,
    verdict:
      fetchStats.parsedCards < browserStats.parsedCards
        ? 'fetch under-delivers vs browser on same URL — likely bot soft-throttle / incomplete SSR for non-browser clients'
        : fetchStats.parsedCards === browserStats.parsedCards
          ? 'parity'
          : 'fetch has MORE than browser (unexpected)',
  }
  await writeFile(resolve(outDir, 'diag.json'), JSON.stringify(report, null, 2))
  console.log('\nVerdict:', report.verdict)
  console.log('Saved:', outDir)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
