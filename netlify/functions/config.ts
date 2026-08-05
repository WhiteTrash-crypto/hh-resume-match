import type { Handler } from '@netlify/functions'
import { extractSheetId, isReadyToParse, saveSession } from '../../shared/store'
import { verifySheetAccess } from '../../shared/sheets'
import { json, requireSession, withCors } from './_lib'

const baseHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }
  const { session, headers } = await requireSession(event)
  let body: {
    sheetUrl?: string
    query?: string
    remoteOnly?: boolean
    periodDays?: number
    maxPages?: number
  }
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Некорректный JSON' }, headers)
  }

  if (body.sheetUrl !== undefined) {
    const sheetId = extractSheetId(body.sheetUrl)
    if (!sheetId) {
      return json(400, { error: 'Не удалось разобрать ссылку на Google Sheet' }, headers)
    }
    try {
      await verifySheetAccess(sheetId)
    } catch {
      return json(
        400,
        {
          error:
            'Нет доступа к таблице. Расшарьте её на service account как Редактор и попробуйте снова.',
        },
        headers,
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
  return json(
    200,
    {
      config: session.config,
      ready: readiness.ok,
      missing: readiness.missing,
    },
    headers,
  )
}

export const handler = withCors(baseHandler)
