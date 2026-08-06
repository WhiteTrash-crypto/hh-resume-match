import { v4 as uuid } from 'uuid'
import { vacancyBudgetForKeyCount } from '../../shared/budget'
import { parseSearchQueries, startHhCollect } from '../../shared/hh'
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

  const queries = parseSearchQueries(session.config.query || '')
  if (!queries.length) {
    return json({ error: 'Укажите хотя бы один поисковый ключ' }, { status: 400 })
  }

  const vacancyBudget = vacancyBudgetForKeyCount(queries.length)

  try {
    const { runIds, pagesPerQuery, vacanciesPerQuery } = await startHhCollect({
      query: session.config.query!,
      remoteOnly: session.config.remoteOnly !== false,
      periodDays: session.config.periodDays || 7,
      vacancyBudget,
    })
    const plan = queries
      .map((q, i) => `${q}→${vacanciesPerQuery[i] || 0} вак. (~${pagesPerQuery[i] || 0} стр.)`)
      .join(', ')
    session.job = {
      id: uuid(),
      status: 'collecting',
      message: `Сбор hh.ru (${queries.length} ключ., бюджет ${vacancyBudget} вак.): ${plan}`,
      apifyRunId: runIds[0],
      apifyRunIds: runIds,
      queries,
      vacancyBudget,
      startedAt: new Date().toISOString(),
    }
    session.config.maxPages = pagesPerQuery.reduce((a, b) => a + b, 0)
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
