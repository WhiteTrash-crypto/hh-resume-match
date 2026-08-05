import type { Handler } from '@netlify/functions'
import { scoreVacancy } from '../../shared/ats'
import { applyHardFilters } from '../../shared/filters'
import { getHhCollectStatus } from '../../shared/hh'
import { writeResults } from '../../shared/sheets'
import { saveSession } from '../../shared/store'
import type { AtsResult, Vacancy } from '../../shared/types'
import { json, requireSession, withCors } from './_lib'

const SCORE_BATCH = 3
const MAX_SCORE = 25

const baseHandler: Handler = async (event) => {
  const { session, headers } = await requireSession(event)
  const job = session.job

  if (!job.apifyRunId || job.status === 'idle' || job.status === 'done' || job.status === 'error') {
    return json(200, { job }, headers)
  }

  try {
    if (job.status === 'collecting') {
      const { status, items } = await getHhCollectStatus(job.apifyRunId)
      if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        job.message = `Сбор вакансий: ${status}`
        await saveSession(session)
        return json(200, { job }, headers)
      }
      if (status !== 'SUCCEEDED' || !items) {
        job.status = 'error'
        job.error = `Apify: ${status}`
        job.message = 'Ошибка сбора'
        job.finishedAt = new Date().toISOString()
        await saveSession(session)
        return json(200, { job }, headers)
      }

      const filtered: Vacancy[] = []
      for (const v of items) {
        if (applyHardFilters(v).ok) filtered.push(v)
      }
      const capped = filtered.slice(0, MAX_SCORE)
      session.pipeline = { vacancies: capped, scores: [], cursor: 0 }
      job.status = 'scoring'
      job.message = `ATS-скоринг 0/${capped.length}`
      job.stats = {
        fetched: items.length,
        afterHardFilter: filtered.length,
        scored: 0,
        writtenQualified: 0,
        writtenCandidates: 0,
      }
      await saveSession(session)
      return json(200, { job }, headers)
    }

    if (job.status === 'scoring') {
      const pipe = session.pipeline
      if (!pipe) {
        job.status = 'error'
        job.error = 'Нет данных пайплайна'
        await saveSession(session)
        return json(200, { job }, headers)
      }

      const resumeText = session.resumes
        .map((r) => session.resumeTexts[r.id] || '')
        .filter(Boolean)
        .join('\n\n---\n\n')

      const end = Math.min(pipe.cursor + SCORE_BATCH, pipe.vacancies.length)
      for (let i = pipe.cursor; i < end; i++) {
        const score = await scoreVacancy(resumeText, pipe.vacancies[i])
        pipe.scores.push(score)
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
        return json(200, { job }, headers)
      }

      job.status = 'writing'
      job.message = 'Пишем в Google Sheet…'
      await saveSession(session)
      // fall through on next poll — or write now
    }

    if (job.status === 'writing') {
      const pipe = session.pipeline
      if (!pipe) {
        job.status = 'error'
        job.error = 'Нет данных для записи'
        await saveSession(session)
        return json(200, { job }, headers)
      }

      const scoreMap = new Map(pipe.scores.map((s) => [s.vacancyId, s]))
      const qualified: Array<Vacancy & AtsResult> = []
      for (const v of pipe.vacancies) {
        const s = scoreMap.get(v.vacancyId)
        if (s && s.score >= 65) qualified.push({ ...v, ...s })
      }

      const written = await writeResults({
        sheetId: session.config.sheetId!,
        candidates: pipe.vacancies,
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
      return json(200, { job }, headers)
    }

    return json(200, { job }, headers)
  } catch (e) {
    job.status = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.message = 'Ошибка обработки'
    job.finishedAt = new Date().toISOString()
    await saveSession(session)
    return json(200, { job }, headers)
  }
}

export const handler = withCors(baseHandler)
