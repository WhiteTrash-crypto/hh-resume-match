import type { Handler } from '@netlify/functions'
import { isReadyToParse } from '../../shared/store'
import { json, requireSession, withCors } from './_lib'

const baseHandler: Handler = async (event) => {
  const { session, headers } = await requireSession(event)
  const readiness = isReadyToParse(session)
  return json(
    200,
    {
      id: session.id,
      resumes: session.resumes,
      config: {
        sheetUrl: session.config.sheetUrl || '',
        query: session.config.query || '',
        remoteOnly: session.config.remoteOnly !== false,
        periodDays: session.config.periodDays || 7,
        maxPages: session.config.maxPages || 1,
      },
      job: session.job,
      ready: readiness.ok,
      missing: readiness.missing,
      saEmail:
        process.env.PUBLIC_GOOGLE_SA_EMAIL ||
        'linkedin-scraper@sapient-forest-504606-f3.iam.gserviceaccount.com',
    },
    headers,
  )
}

export const handler = withCors(baseHandler)
