import { scoreVacancy } from '../../shared/ats'
import { vacancyBudgetForKeyCount } from '../../shared/budget'
import { applyHardFilters } from '../../shared/filters'
import {
  advanceHhCollect,
  collectProgressLabel,
  parseSearchQueries,
  type HhCollectPlan,
} from '../../shared/hh'
import { QUERY_RELEVANCE_MIN, scoreQueryRelevance } from '../../shared/relevance'
import { writeResults } from '../../shared/sheets'
import { saveSession } from '../../shared/store'
import type { AtsResult, HhCollectState, Vacancy } from '../../shared/types'
import { json, withApi } from './_lib'

const SCORE_BATCH = 3
const QUALIFIED_MIN = 65

function toPlan(collect: HhCollectState): HhCollectPlan {
  return {
    queries: collect.queries,
    pagesPerQuery: collect.pagesPerQuery,
    vacanciesPerQuery: collect.vacanciesPerQuery,
    vacancyBudget: collect.vacancyBudget,
    areaIds: collect.areaIds,
    regionsResolved: [],
    remoteOnly: collect.remoteOnly,
    periodDays: collect.periodDays,
  }
}

export default withApi(async (_req, session) => {
  const job = session.job
  const searchQueries =
    job.queries?.length
      ? job.queries
      : parseSearchQueries(session.config.query || '')
  const vacancyCap =
    job.vacancyBudget ||
    vacancyBudgetForKeyCount(searchQueries.length || 1)

  if (job.status === 'idle' || job.status === 'done' || job.status === 'error') {
    return json({ job })
  }

  try {
    if (job.status === 'collecting') {
      const pipe = session.pipeline
      const collect = pipe?.collect
      if (!pipe || !collect) {
        job.status = 'error'
        job.error = 'Нет плана сбора'
        job.message = 'Ошибка сбора'
        job.finishedAt = new Date().toISOString()
        await saveSession(session)
        return json({ job })
      }

      const next = await advanceHhCollect(toPlan(collect), {
        phase: collect.phase,
        ids: collect.ids,
        cards: collect.cards,
        detailsDone: collect.detailsDone,
        items: collect.items,
        apifyRunId: collect.apifyRunId,
        apifyRunIds: collect.apifyRunIds,
        fellBackFromApify: collect.fellBackFromApify,
      })

      pipe.collect = {
        ...collect,
        phase: next.phase,
        ids: next.ids,
        cards: next.cards,
        detailsDone: next.detailsDone,
        items: next.items,
        apifyRunId: next.apifyRunId,
        apifyRunIds: next.apifyRunIds,
        fellBackFromApify: next.fellBackFromApify,
      }
      job.message = collectProgressLabel(next)
      if (next.fellBackFromApify && !job.message.includes('Apify→fetch')) {
        job.message = `${job.message} (Apify→fetch)`
      }

      if (next.phase !== 'done') {
        await saveSession(session)
        return json({ job })
      }

      const items = next.items
      const filtered: Vacancy[] = []
      const scored: Array<{ v: Vacancy; rel: number }> = []
      for (const v of items) {
        if (!applyHardFilters(v).ok) continue
        const rel = scoreQueryRelevance(searchQueries, v)
        if (rel.score < QUERY_RELEVANCE_MIN) continue
        scored.push({ v, rel: rel.score })
      }
      scored.sort((a, b) => b.rel - a.rel)
      for (const row of scored) {
        filtered.push(row.v)
        if (filtered.length >= vacancyCap) break
      }
      session.pipeline = { vacancies: filtered, scores: [], cursor: 0 }
      job.status = 'scoring'
      job.message = `ATS-скоринг 0/${filtered.length} (бюджет ${vacancyCap})`
      job.stats = {
        fetched: items.length,
        afterHardFilter: filtered.length,
        scored: 0,
        writtenQualified: 0,
        writtenCandidates: 0,
      }
      await saveSession(session)
      return json({ job })
    }

    if (job.status === 'scoring') {
      const pipe = session.pipeline
      if (!pipe) {
        job.status = 'error'
        job.error = 'Нет данных пайплайна'
        await saveSession(session)
        return json({ job })
      }

      const resumeText = session.resumes
        .map((r) => session.resumeTexts[r.id] || '')
        .filter(Boolean)
        .join('\n\n---\n\n')

      const end = Math.min(pipe.cursor + SCORE_BATCH, pipe.vacancies.length)
      for (let i = pipe.cursor; i < end; i++) {
        pipe.scores.push(await scoreVacancy(resumeText, pipe.vacancies[i], searchQueries))
      }
      pipe.cursor = end
      job.stats = {
        ...(job.stats || {
          fetched: 0,
          afterHardFilter: pipe.vacancies.length,
          scored: 0,
          writtenQualified: 0,
          writtenCandidates: 0,
        }),
        scored: pipe.scores.length,
      }
      job.message = `ATS-скоринг ${pipe.scores.length}/${pipe.vacancies.length}`

      if (pipe.cursor < pipe.vacancies.length) {
        await saveSession(session)
        return json({ job })
      }

      job.status = 'writing'
      job.message = 'Пишем в Google Sheet…'
      await saveSession(session)
    }

    if (job.status === 'writing') {
      const pipe = session.pipeline
      if (!pipe) {
        job.status = 'error'
        job.error = 'Нет данных для записи'
        await saveSession(session)
        return json({ job })
      }

      const scoreMap = new Map(pipe.scores.map((s) => [s.vacancyId, s]))
      const qualified: Array<Vacancy & AtsResult> = []
      for (const v of pipe.vacancies) {
        const s = scoreMap.get(v.vacancyId)
        if (!s || s.score < QUALIFIED_MIN) continue
        if (s.redFlags.includes('wrong_role')) continue
        const rel = scoreQueryRelevance(searchQueries, v)
        if (rel.score < 65) continue
        qualified.push({ ...v, ...s })
      }

      // Best matches first in both sheets
      qualified.sort((a, b) => b.score - a.score)
      const candidatesOrdered = [...pipe.vacancies].sort((a, b) => {
        const sa = scoreMap.get(a.vacancyId)?.score ?? 0
        const sb = scoreMap.get(b.vacancyId)?.score ?? 0
        return sb - sa
      })

      const written = await writeResults({
        sheetId: session.config.sheetId!,
        candidates: candidatesOrdered,
        qualified,
      })

      job.status = 'done'
      job.message = 'Готово'
      job.finishedAt = new Date().toISOString()
      job.stats = {
        fetched: job.stats?.fetched || pipe.vacancies.length,
        afterHardFilter: job.stats?.afterHardFilter || pipe.vacancies.length,
        scored: pipe.scores.length,
        writtenCandidates: written.writtenCandidates,
        writtenQualified: written.writtenQualified,
      }
      session.pipeline = undefined
      await saveSession(session)
      return json({ job })
    }

    return json({ job })
  } catch (e) {
    job.status = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.message = 'Ошибка обработки'
    job.finishedAt = new Date().toISOString()
    await saveSession(session)
    return json({ job })
  }
})
