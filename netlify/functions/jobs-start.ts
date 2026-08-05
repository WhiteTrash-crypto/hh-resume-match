import type { Handler } from '@netlify/functions'
import { v4 as uuid } from 'uuid'
import { startHhCollect } from '../../shared/hh'
import { isReadyToParse, saveSession } from '../../shared/store'
import { json, requireSession, withCors } from './_lib'

const baseHandler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  const { session, headers } = await requireSession(event)
  const readiness = isReadyToParse(session)
  if (!readiness.ok) {
    return json(400, { error: 'Не хватает полей', missing: readiness.missing }, headers)
  }
  if (['collecting', 'filtering', 'scoring', 'writing'].includes(session.job.status)) {
    return json(409, { error: 'Уже выполняется задача', job: session.job }, headers)
  }

  try {
    const { runId } = await startHhCollect({
      query: session.config.query!,
      remoteOnly: session.config.remoteOnly !== false,
      periodDays: session.config.periodDays || 7,
      maxPages: session.config.maxPages || 1,
    })
    session.job = {
      id: uuid(),
      status: 'collecting',
      message: 'Сбор вакансий с hh.ru…',
      apifyRunId: runId,
      startedAt: new Date().toISOString(),
    }
    session.pipeline = undefined
    await saveSession(session)
    return json(200, { job: session.job }, headers)
  } catch (e) {
    session.job = {
      id: uuid(),
      status: 'error',
      message: 'Ошибка запуска сбора',
      error: e instanceof Error ? e.message : String(e),
    }
    await saveSession(session)
    return json(500, { error: session.job.error, job: session.job }, headers)
  }
}

export const handler = withCors(baseHandler)
