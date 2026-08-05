import { google } from 'googleapis'
import { readFile } from 'node:fs/promises'
import type { AtsResult, Vacancy } from './types'

const CANDIDATES_HEADERS = [
  'collected_at',
  'vacancy_id',
  'url',
  'title',
  'employer',
  'location',
  'salary',
  'experience',
  'schedule',
  'snippet',
  'status',
]

const QUALIFIED_HEADERS = [
  'validated_at',
  'vacancy_id',
  'url',
  'score',
  'domain_tier',
  'role',
  'work_mode',
  'employer',
  'salary',
  'reason',
  'red_flags',
  'snippet',
]

async function loadCredentials(): Promise<Record<string, unknown>> {
  const b64 = process.env.GOOGLE_SA_JSON_BASE64?.trim()
  const raw = process.env.GOOGLE_SA_JSON?.trim()
  let parsed: Record<string, unknown>

  if (b64) {
    parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  } else if (raw) {
    parsed = JSON.parse(raw)
  } else {
    const p = process.env.GOOGLE_SA_PATH
    if (p) {
      parsed = JSON.parse(await readFile(p, 'utf8'))
    } else {
      throw new Error(
        'На сервере не задан GOOGLE_SA_JSON (или GOOGLE_SA_JSON_BASE64). GOOGLE_SA_PATH на Netlify не работает.',
      )
    }
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SA_JSON битый: нет client_email или private_key')
  }
  return parsed
}

async function getSheets() {
  const credentials = await loadCredentials()
  const auth = new google.auth.GoogleAuth({
    credentials: credentials as never,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
  return google.sheets({ version: 'v4', auth })
}

async function ensureSheet(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  title: string,
  headers: string[],
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existing = meta.data.sheets?.find((s) => s.properties?.title === title)
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    })
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    })
    return
  }
  const values = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!1:1`,
  })
  if (!values.data.values?.[0]?.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    })
  }
}

export async function writeResults(opts: {
  sheetId: string
  candidates: Vacancy[]
  qualified: Array<Vacancy & AtsResult>
}): Promise<{ writtenCandidates: number; writtenQualified: number }> {
  const sheets = await getSheets()
  await ensureSheet(sheets, opts.sheetId, 'hh_candidates', CANDIDATES_HEADERS)
  await ensureSheet(sheets, opts.sheetId, 'hh_qualified', QUALIFIED_HEADERS)

  const now = new Date().toISOString()
  const existingCand = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.sheetId,
    range: 'hh_candidates!B:B',
  })
  const seenCand = new Set((existingCand.data.values || []).flat().slice(1))

  const candRows = opts.candidates
    .filter((v) => !seenCand.has(v.vacancyId))
    .map((v) => [
      now,
      v.vacancyId,
      v.url,
      v.title,
      v.employer,
      v.location,
      v.salary,
      v.experience,
      v.schedule,
      v.snippet,
      'scored',
    ])

  if (candRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: opts.sheetId,
      range: 'hh_candidates!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: candRows },
    })
  }

  const existingQual = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.sheetId,
    range: 'hh_qualified!B:B',
  })
  const seenQual = new Set((existingQual.data.values || []).flat().slice(1))

  const qualRows = opts.qualified
    .filter((v) => !seenQual.has(v.vacancyId))
    .map((v) => [
      now,
      v.vacancyId,
      v.url,
      v.score,
      v.domainTier,
      v.role,
      v.workMode,
      v.employer,
      v.salary,
      v.reason,
      v.redFlags,
      v.snippet,
    ])

  if (qualRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: opts.sheetId,
      range: 'hh_qualified!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: qualRows },
    })
  }

  return {
    writtenCandidates: candRows.length,
    writtenQualified: qualRows.length,
  }
}

export async function verifySheetAccess(sheetId: string): Promise<boolean> {
  try {
    const sheets = await getSheets()
    await sheets.spreadsheets.get({ spreadsheetId: sheetId })
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/GOOGLE_SA_JSON|GOOGLE_SA_PATH|private_key|client_email|битый/i.test(msg)) {
      throw e
    }
    if (/permission|forbidden|403|404|not found|insufficient/i.test(msg)) {
      throw new Error(
        `Нет доступа к таблице (${msg}). Проверьте шаринг на service account и что в Netlify задан GOOGLE_SA_JSON того же аккаунта.`,
      )
    }
    throw new Error(`Google Sheets API: ${msg}`)
  }
}
