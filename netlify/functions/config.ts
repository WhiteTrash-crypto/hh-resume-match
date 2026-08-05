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
      return json({ error: 'Не удалось разобрать ссылку на Google Sheet' }, { status: 400 })
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

  if (body.query !== undefined) session.config.query = body.query.trim()
  if (body.remoteOnly !== undefined) session.config.remoteOnly = Boolean(body.remoteOnly)
  if (body.periodDays !== undefined) {
    session.config.periodDays = Math.max(1, Math.min(30, Number(body.periodDays) || 7))
  }
  if (body.maxPages !== undefined) {
    session.config.maxPages = Math.max(1, Math.min(3, Number(body.maxPages) || 1))
  }

  await saveSession(session)
  const readiness = isReadyToParse(session)
  return json({
    config: session.config,
    ready: readiness.ok,
    missing: readiness.missing,
  })
})
