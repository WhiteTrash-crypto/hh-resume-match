import { v4 as uuid } from 'uuid'
import { startHhCollect } from '../../shared/hh'
import { isReadyToParse, saveSession } from '../../shared/store'
import { json, withApi } from './_lib'

export default withApi(async (req, session) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  const readiness = isReadyToParse(session)
  if (!readiness.ok) {
    return json(
      { error: 'Не хватает полей', missing: readiness.missing },
      { status: 400 },
    )
  }
  if (['collecting', 'filtering', 'scoring', 'writing'].includes(session.job.status)) {
    return json({ error: 'Уже выполняется задача', job: session.job }, { status: 409 })
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
    return json({ job: session.job })
  } catch (e) {
    session.job = {
      id: uuid(),
      status: 'error',
      message: 'Ошибка запуска сбора',
      error: e instanceof Error ? e.message : String(e),
    }
    await saveSession(session)
    return json({ error: session.job.error, job: session.job }, { status: 500 })
  }
})
