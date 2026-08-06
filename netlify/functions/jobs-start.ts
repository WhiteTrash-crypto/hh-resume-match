import { v4 as uuid } from 'uuid'
import {
  consumeAccessKey,
  peekAccessKey,
  refundAccessKey,
} from '../../shared/accessKeys'
import { vacancyBudgetForKeyCount } from '../../shared/budget'
import { emptyCollectProgress, parseSearchQueries, planHhCollect } from '../../shared/hh'
import { isReadyToParse, saveSession } from '../../shared/store'
import type { HhCollectState } from '../../shared/types'
import { json, withApi } from './_lib'

export default withApi(async (req, session) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (!session.access?.key) {
    return json(
      {
        error: 'Нужен ключ доступа',
        code: 'locked',
        access: { unlocked: false, usesLeft: 0 },
      },
      { status: 401 },
    )
  }

  const accessKey = session.access.key
  const ledger = await peekAccessKey(accessKey)
  const usesLeft = ledger?.usesLeft ?? session.access.usesLeft
  if (!ledger || usesLeft <= 0) {
    session.access.usesLeft = 0
    await saveSession(session)
    return json(
      {
        error: 'Ключ истёк — лимит запросов исчерпан',
        code: 'expired',
        access: { unlocked: true, usesLeft: 0 },
      },
      { status: 403 },
    )
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

  const consumed = await consumeAccessKey(accessKey)
  if (!consumed.ok) {
    return json(
      {
        error: consumed.error,
        code: consumed.code,
        access: { unlocked: true, usesLeft: 0 },
      },
      { status: 403 },
    )
  }
  session.access.usesLeft = consumed.usesLeft
  await saveSession(session)

  const vacancyBudget = vacancyBudgetForKeyCount(queries.length)

  try {
    const plan = planHhCollect({
      query: session.config.query!,
      regions: session.config.regions || '',
      remoteOnly: session.config.remoteOnly !== false,
      periodDays: session.config.periodDays || 7,
      vacancyBudget,
    })

    const progress = emptyCollectProgress()
    const collect: HhCollectState = {
      queries: plan.queries,
      pagesPerQuery: plan.pagesPerQuery,
      vacanciesPerQuery: plan.vacanciesPerQuery,
      vacancyBudget: plan.vacancyBudget,
      areaIds: plan.areaIds,
      remoteOnly: plan.remoteOnly,
      periodDays: plan.periodDays,
      phase: progress.phase,
      ids: progress.ids,
      cards: progress.cards,
      detailsDone: progress.detailsDone,
      items: progress.items,
    }

    const planLabel = queries
      .map(
        (q, i) =>
          `${q}→${plan.vacanciesPerQuery[i] || 0} вак. (~${plan.pagesPerQuery[i] || 0} стр.)`,
      )
      .join(', ')
    const regionLabel = plan.regionsResolved
      .map((r) => r.name)
      .filter(Boolean)
      .join(', ')

    session.job = {
      id: uuid(),
      status: 'collecting',
      message: `Сбор hh.ru (${queries.length} ключ., ${regionLabel || 'Россия'}, бюджет ${vacancyBudget} вак., area=${plan.areaIds.join('|')}): ${planLabel}`,
      queries,
      vacancyBudget,
      startedAt: new Date().toISOString(),
    }
    session.config.maxPages = plan.pagesPerQuery.reduce((a, b) => a + b, 0)
    session.pipeline = { vacancies: [], scores: [], cursor: 0, collect }
    await saveSession(session)
    return json({
      job: session.job,
      access: {
        unlocked: true,
        usesLeft: consumed.usesLeft,
      },
    })
  } catch (e) {
    const refunded = await refundAccessKey(accessKey)
    if (refunded && session.access) {
      session.access.usesLeft = refunded.usesLeft
    }
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
