import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useLocalBlobFallback } from './store'

export const DEFAULT_USES_PER_KEY = 2

export type AccessKeyRecord = {
  keyHash: string
  usesTotal: number
  usesLeft: number
  createdAt: string
  updatedAt: string
  hint?: string
}

export type AccessUnlockResult =
  | { ok: true; usesLeft: number; usesTotal: number; keyHash: string }
  | { ok: false; code: 'invalid' | 'expired' | 'not_configured'; error: string }

const LOCAL_DIR = path.join(process.cwd(), '.data', 'access-keys')

function blobsStore() {
  return getStore({ name: 'access-keys', consistency: 'strong' })
}

export function hashAccessKey(raw: string): string {
  const salt = process.env.SESSION_SECRET || process.env.ACCESS_KEY_SALT || 'hrm-access'
  return createHash('sha256').update(`${salt}:${raw.trim()}`).digest('hex')
}

export function usesPerKey(): number {
  const n = Number(process.env.ACCESS_KEY_USES || DEFAULT_USES_PER_KEY)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_USES_PER_KEY
}

/** Allowlist: ACCESS_KEYS=key1,key2 or newline-separated. */
export function configuredAccessKeys(): string[] {
  const raw = process.env.ACCESS_KEYS || ''
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const k = part.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

async function getRecord(keyHash: string): Promise<AccessKeyRecord | null> {
  if (useLocalBlobFallback()) {
    try {
      const raw = await readFile(path.join(LOCAL_DIR, `${keyHash}.json`), 'utf8')
      return JSON.parse(raw) as AccessKeyRecord
    } catch {
      return null
    }
  }
  try {
    return (await blobsStore().get(keyHash, { type: 'json' })) as AccessKeyRecord | null
  } catch (e) {
    console.error('access-keys get failed', e)
    throw new Error('Не удалось прочитать ключ доступа (Blobs)')
  }
}

async function setRecord(rec: AccessKeyRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString()
  if (useLocalBlobFallback()) {
    await mkdir(LOCAL_DIR, { recursive: true })
    await writeFile(path.join(LOCAL_DIR, `${rec.keyHash}.json`), JSON.stringify(rec), 'utf8')
    return
  }
  try {
    await blobsStore().setJSON(rec.keyHash, rec)
  } catch (e) {
    console.error('access-keys set failed', e)
    throw new Error('Не удалось сохранить ключ доступа (Blobs)')
  }
}

export async function unlockAccessKey(rawKey: string): Promise<AccessUnlockResult> {
  const key = (rawKey || '').trim()
  if (!key) {
    return { ok: false, code: 'invalid', error: 'Введите ключ доступа' }
  }
  if (!configuredAccessKeys().length) {
    return {
      ok: false,
      code: 'not_configured',
      error: 'Ключи доступа не настроены на сервере (ACCESS_KEYS)',
    }
  }
  if (!configuredAccessKeys().includes(key)) {
    return { ok: false, code: 'invalid', error: 'Неверный ключ доступа' }
  }

  const keyHash = hashAccessKey(key)
  const total = usesPerKey()
  let rec = await getRecord(keyHash)
  if (!rec) {
    const now = new Date().toISOString()
    rec = {
      keyHash,
      usesTotal: total,
      usesLeft: total,
      createdAt: now,
      updatedAt: now,
      hint: key.slice(-4),
    }
    await setRecord(rec)
  }

  if (rec.usesLeft <= 0) {
    return { ok: false, code: 'expired', error: 'Ключ истёк — лимит запросов исчерпан' }
  }

  return {
    ok: true,
    usesLeft: rec.usesLeft,
    usesTotal: rec.usesTotal,
    keyHash: rec.keyHash,
  }
}

export async function consumeAccessKey(keyHash: string): Promise<AccessUnlockResult> {
  if (!keyHash) {
    return { ok: false, code: 'invalid', error: 'Нет активного ключа доступа' }
  }
  const rec = await getRecord(keyHash)
  if (!rec) {
    return { ok: false, code: 'invalid', error: 'Ключ доступа не найден' }
  }
  if (rec.usesLeft <= 0) {
    return { ok: false, code: 'expired', error: 'Ключ истёк — лимит запросов исчерпан' }
  }
  rec.usesLeft -= 1
  await setRecord(rec)
  return {
    ok: true,
    usesLeft: rec.usesLeft,
    usesTotal: rec.usesTotal,
    keyHash: rec.keyHash,
  }
}

/** Refund one use if Apify start failed after consume. */
export async function refundAccessKey(keyHash: string): Promise<AccessKeyRecord | null> {
  const rec = await getRecord(keyHash)
  if (!rec) return null
  if (rec.usesLeft < rec.usesTotal) {
    rec.usesLeft += 1
    await setRecord(rec)
  }
  return rec
}

export async function peekAccessKey(keyHash: string): Promise<AccessKeyRecord | null> {
  if (!keyHash) return null
  return getRecord(keyHash)
}
