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

async function loadCredentials(): Promise<object> {
  const raw = process.env.GOOGLE_SA_JSON
  if (raw) return JSON.parse(raw)
  const p = process.env.GOOGLE_SA_PATH
  if (p) return JSON.parse(await readFile(p, 'utf8'))
  throw new Error('GOOGLE_SA_JSON или GOOGLE_SA_PATH не задан')
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
  const sheets = await getSheets()
  await sheets.spreadsheets.get({ spreadsheetId: sheetId })
  return true
}
