import { getStore } from '@netlify/blobs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionData } from './types'

const LOCAL_DIR = path.join(process.cwd(), '.data', 'sessions')

/**
 * Local filesystem only for `netlify dev` on your machine.
 * On Netlify cloud always use Blobs — ignore mistaken NETLIFY_DEV site env.
 */
function useLocal(): boolean {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false
  if (process.env.NETLIFY === 'true' && process.env.NETLIFY_DEV !== 'true') return false
  // If NETLIFY_DEV was wrongly set in Netlify UI, Lambda name still forces Blobs above.
  return true
}

function blobsStore() {
  return getStore({ name: 'sessions', consistency: 'strong' })
}

async function localGet(id: string): Promise<SessionData | null> {
  try {
    const raw = await readFile(path.join(LOCAL_DIR, `${id}.json`), 'utf8')
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

async function localSet(id: string, data: SessionData): Promise<void> {
  await mkdir(LOCAL_DIR, { recursive: true })
  await writeFile(path.join(LOCAL_DIR, `${id}.json`), JSON.stringify(data), 'utf8')
}

export async function getSession(id: string): Promise<SessionData | null> {
  if (useLocal()) return localGet(id)
  try {
    return (await blobsStore().get(id, { type: 'json' })) as SessionData | null
  } catch (e) {
    console.error('blobs get failed', e)
    throw new Error('Не удалось прочитать сессию (Netlify Blobs).')
  }
}

export async function saveSession(data: SessionData): Promise<void> {
  data.updatedAt = new Date().toISOString()
  if (useLocal()) {
    await localSet(data.id, data)
    return
  }
  try {
    await blobsStore().setJSON(data.id, data)
  } catch (e) {
    console.error('blobs set failed', e)
    throw new Error('Не удалось сохранить сессию (Netlify Blobs).')
  }
}

export function emptySession(id: string): SessionData {
  const now = new Date().toISOString()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    resumes: [],
    resumeTexts: {},
    config: {
      query: 'продакт-менеджер',
      remoteOnly: true,
      periodDays: 7,
      maxPages: 1,
    },
    job: {
      id: '',
      status: 'idle',
      message: 'Ожидание запуска',
    },
  }
}

export function isReadyToParse(session: SessionData): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!session.resumes.length) missing.push('резюме')
  if (!session.config.sheetId) missing.push('ссылка на Google Sheet')
  if (!session.config.query?.trim()) missing.push('поисковый запрос')
  return { ok: missing.length === 0, missing }
}

export function extractSheetId(urlOrId: string): string | null {
  const raw = (urlOrId || '').trim()
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw) && !raw.includes('/')) return raw
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m?.[1] ?? null
}
