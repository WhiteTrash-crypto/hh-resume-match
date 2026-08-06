import { getSheetsClient } from './sheets'

export type AccessKeyRecord = {
  /** Plain key from column A */
  key: string
  /** 1-based row in the keys sheet */
  row: number
  /** Remaining uses from column B */
  usesLeft: number
}

export type AccessUnlockResult =
  | { ok: true; key: string; usesLeft: number }
  | { ok: false; code: 'invalid' | 'expired' | 'not_configured'; error: string }

const DEFAULT_KEYS_SHEET_ID = '1vxccqrxcPzX1dOK3LM_q9YRvjRvhdoPGDAt-OIicRNk'

export function accessKeysSheetId(): string {
  return (
    process.env.ACCESS_KEYS_SHEET_ID?.trim() ||
    process.env.ACCESS_KEYS_SHEET?.trim() ||
    DEFAULT_KEYS_SHEET_ID
  )
}

function accessKeysTab(): string {
  return process.env.ACCESS_KEYS_SHEET_TAB?.trim() || 'Лист1'
}

function parseUses(raw: unknown): number {
  const n = Number(String(raw ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

async function findKeyRow(rawKey: string): Promise<AccessKeyRecord | null> {
  const key = (rawKey || '').trim()
  if (!key) return null

  const sheets = await getSheetsClient()
  const spreadsheetId = accessKeysSheetId()
  const tab = accessKeysTab()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A:B`,
  })
  const rows = res.data.values || []
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i]?.[0] ?? '').trim()
    if (!cell) continue
    if (cell.toLowerCase() !== key.toLowerCase()) continue
    return {
      key: cell,
      row: i + 1,
      usesLeft: parseUses(rows[i]?.[1]),
    }
  }
  return null
}

async function writeUsesLeft(row: number, usesLeft: number): Promise<void> {
  const sheets = await getSheetsClient()
  const spreadsheetId = accessKeysSheetId()
  const tab = accessKeysTab()
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!B${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[usesLeft]] },
  })
}

/**
 * Validate key against Google Sheet (A = key, B = remaining uses).
 */
export async function unlockAccessKey(rawKey: string): Promise<AccessUnlockResult> {
  const key = (rawKey || '').trim()
  if (!key) {
    return { ok: false, code: 'invalid', error: 'Введите ключ доступа' }
  }

  let rec: AccessKeyRecord | null
  try {
    rec = await findKeyRow(key)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/GOOGLE_SA_JSON|permission|forbidden|403|404/i.test(msg)) {
      return {
        ok: false,
        code: 'not_configured',
        error: `Нет доступа к таблице ключей: ${msg}`,
      }
    }
    throw e
  }

  if (!rec) {
    return { ok: false, code: 'invalid', error: 'Неверный ключ доступа' }
  }
  if (rec.usesLeft <= 0) {
    return { ok: false, code: 'expired', error: 'Ключ истёк — лимит запросов исчерпан' }
  }
  return { ok: true, key: rec.key, usesLeft: rec.usesLeft }
}

export async function peekAccessKey(key: string): Promise<AccessKeyRecord | null> {
  if (!key) return null
  try {
    return await findKeyRow(key)
  } catch (e) {
    console.error('peekAccessKey failed', e)
    return null
  }
}

export async function consumeAccessKey(key: string): Promise<AccessUnlockResult> {
  const rec = await findKeyRow(key)
  if (!rec) {
    return { ok: false, code: 'invalid', error: 'Ключ доступа не найден' }
  }
  if (rec.usesLeft <= 0) {
    return { ok: false, code: 'expired', error: 'Ключ истёк — лимит запросов исчерпан' }
  }
  const next = rec.usesLeft - 1
  await writeUsesLeft(rec.row, next)
  return { ok: true, key: rec.key, usesLeft: next }
}

/** Refund one use if Apify start failed after consume. */
export async function refundAccessKey(key: string): Promise<AccessKeyRecord | null> {
  const rec = await findKeyRow(key)
  if (!rec) return null
  const next = rec.usesLeft + 1
  await writeUsesLeft(rec.row, next)
  return { ...rec, usesLeft: next }
}
