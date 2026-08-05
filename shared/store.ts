import { getStore } from '@netlify/blobs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionData } from './types'

const LOCAL_DIR = path.join(process.cwd(), '.data', 'sessions')

function useLocal(): boolean {
  return process.env.NETLIFY_DEV === 'true' || process.env.NODE_ENV === 'development' || !process.env.NETLIFY
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
    const store = getStore('sessions')
    return (await store.get(id, { type: 'json' })) as SessionData | null
  } catch {
    return localGet(id)
  }
}

export async function saveSession(data: SessionData): Promise<void> {
  data.updatedAt = new Date().toISOString()
  if (useLocal()) {
    await localSet(data.id, data)
    return
  }
  try {
    const store = getStore('sessions')
    await store.setJSON(data.id, data)
  } catch {
    await localSet(data.id, data)
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
