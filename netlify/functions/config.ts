import { extractSheetId, isReadyToParse, saveSession } from '../../shared/store'
import { verifySheetAccess } from '../../shared/sheets'
import { json, withApi } from './_lib'

export default withApi(async (req, session) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: {
    sheetUrl?: string
    query?: string
    regions?: string
    remoteOnly?: boolean
    periodDays?: number
    maxPages?: number
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  if (body.sheetUrl !== undefined) {
    const sheetId = extractSheetId(body.sheetUrl)
    if (!sheetId) {
      return json(
        {
          error:
            'Некорректная ссылка на Google Sheet. Ожидается docs.google.com/spreadsheets/d/…',
        },
        { status: 400 },
      )
    }
    try {
      await verifySheetAccess(sheetId)
    } catch (e) {
      return json(
        {
          error: e instanceof Error ? e.message : 'Нет доступа к таблице',
        },
        { status: 400 },
      )
    }
    session.config.sheetUrl = body.sheetUrl.trim()
    session.config.sheetId = sheetId
  }

  if (body.query !== undefined) {
    const trimmed = body.query.trim()
    const parts = trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 5) {
      return json(
        { error: 'Не больше 5 поисковых ключей (через запятую)' },
        { status: 400 },
      )
    }
    session.config.query = trimmed
  }
  if (body.regions !== undefined) {
    const trimmed = body.regions.trim()
    const parts = trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 8) {
      return json(
        { error: 'Не больше 8 регионов (через запятую)' },
        { status: 400 },
      )
    }
    session.config.regions = trimmed
  }
  if (body.remoteOnly !== undefined) session.config.remoteOnly = Boolean(body.remoteOnly)
  if (body.periodDays !== undefined) {
    session.config.periodDays = Math.max(1, Math.min(30, Number(body.periodDays) || 7))
  }
  // maxPages is derived server-side from key count → vacancy budget

  await saveSession(session)
  const readiness = isReadyToParse(session)
  return json({
    config: session.config,
    ready: readiness.ok,
    missing: readiness.missing,
  })
})
