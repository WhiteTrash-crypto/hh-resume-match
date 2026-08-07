/**
 * Runtime scrape mode for prod: Blobs override > HH_SCRAPE_MODE env > fetch.
 * Toggle via POST /api/scrape-mode without redeploy (when Apify budget runs out).
 */

import { getStore } from '@netlify/blobs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useLocalBlobFallback } from './store.ts'

export type ScrapeMode = 'apify' | 'fetch' | 'browser'

const OPS_KEY = 'scrapeMode'
const LOCAL_PATH = path.join(process.cwd(), '.data', 'ops', 'scrape-mode.json')

export type StoredScrapeMode = {
  mode: ScrapeMode
  updatedAt: string
  /** Why override was set (e.g. apify auto-fallback) */
  reason?: string
}

type Stored = StoredScrapeMode


const ALLOWED = new Set<ScrapeMode>(['apify', 'fetch', 'browser'])

let cache: { mode: ScrapeMode | null; at: number } | null = null
const CACHE_MS = 15_000

function envMode(): ScrapeMode {
  const raw = (process.env.HH_SCRAPE_MODE || '').trim().toLowerCase()
  if (raw === 'apify' || raw === 'browser' || raw === 'fetch') return raw
  return 'fetch'
}

function opsStore() {
  return getStore({ name: 'ops', consistency: 'strong' })
}

async function readOverride(): Promise<Stored | null> {
  if (useLocalBlobFallback()) {
    try {
      const raw = await readFile(LOCAL_PATH, 'utf8')
      return JSON.parse(raw) as Stored
    } catch {
      return null
    }
  }
  try {
    return (await opsStore().get(OPS_KEY, { type: 'json' })) as Stored | null
  } catch (e) {
    console.error('ops scrapeMode get failed', e)
    return null
  }
}

async function writeOverride(stored: Stored | null): Promise<void> {
  cache = null
  if (useLocalBlobFallback()) {
    await mkdir(path.dirname(LOCAL_PATH), { recursive: true })
    if (!stored) {
      try {
        const { unlink } = await import('node:fs/promises')
        await unlink(LOCAL_PATH)
      } catch {
        /* missing ok */
      }
      return
    }
    await writeFile(LOCAL_PATH, JSON.stringify(stored), 'utf8')
    return
  }
  if (!stored) {
    await opsStore().delete(OPS_KEY)
    return
  }
  await opsStore().setJSON(OPS_KEY, stored)
}

export function parseScrapeMode(raw: unknown): ScrapeMode | null {
  const m = String(raw || '')
    .trim()
    .toLowerCase()
  return ALLOWED.has(m as ScrapeMode) ? (m as ScrapeMode) : null
}

/** Effective mode used by collect. */
export async function getScrapeMode(): Promise<ScrapeMode> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) {
    return cache.mode ?? envMode()
  }
  const override = await readOverride()
  const mode = override?.mode && ALLOWED.has(override.mode) ? override.mode : null
  cache = { mode, at: now }
  return mode ?? envMode()
}

export async function getScrapeModeInfo(): Promise<{
  mode: ScrapeMode
  source: 'override' | 'env'
  envDefault: ScrapeMode
  updatedAt: string | null
  reason: string | null
}> {
  const envDefault = envMode()
  const override = await readOverride()
  if (override?.mode && ALLOWED.has(override.mode)) {
    return {
      mode: override.mode,
      source: 'override',
      envDefault,
      updatedAt: override.updatedAt || null,
      reason: override.reason || null,
    }
  }
  return {
    mode: envDefault,
    source: 'env',
    envDefault,
    updatedAt: null,
    reason: null,
  }
}

export async function setScrapeMode(
  mode: ScrapeMode,
  reason?: string,
): Promise<Stored> {
  if (!ALLOWED.has(mode)) throw new Error(`Неизвестный режим: ${mode}`)
  const stored: Stored = {
    mode,
    updatedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  }
  await writeOverride(stored)
  cache = { mode, at: Date.now() }
  return stored
}

/** Persist fetch override after Apify becomes unusable (billing, failed run, …). */
export async function fallbackScrapeModeToFetch(reason: string): Promise<void> {
  const msg = reason.slice(0, 300)
  console.warn('scrape mode auto-fallback apify → fetch:', msg)
  await setScrapeMode('fetch', `apify-fallback: ${msg}`)
}

/** Errors / run statuses that should trip Apify → fetch fallback. */
export function shouldFallbackFromApify(err: unknown): boolean {
  const text = (
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === 'string'
        ? err
        : JSON.stringify(err)
  ).toLowerCase()

  // Explicit run terminal states
  if (
    /apify run .+ → (failed|aborted|timed-out)/i.test(text) ||
    /\b(failed|aborted|timed-out)\b/.test(text)
  ) {
    return true
  }

  // Billing / quota / auth / platform blocks
  const needles = [
    'payment',
    'billing',
    'quota',
    'credit',
    'balance',
    'insufficient',
    'limit exceeded',
    'rate limit',
    'too many requests',
    '402',
    '401',
    '403',
    'not enough',
    'monthly usage',
    'usage hard limit',
    'subscription',
    'apify_token',
    'token не задан',
    'unauthorized',
    'forbidden',
    'out of',
    'не удалось запустить apify',
  ]
  return needles.some((n) => text.includes(n))
}

/** Remove Blobs override — fall back to HH_SCRAPE_MODE env. */
export async function clearScrapeModeOverride(): Promise<void> {
  await writeOverride(null)
  cache = { mode: null, at: Date.now() }
}

export function checkOpsKey(req: Request): boolean {
  const expected = (process.env.HH_OPS_KEY || '').trim()
  if (!expected) return false
  const header =
    req.headers.get('x-ops-key') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    ''
  return header === expected
}
