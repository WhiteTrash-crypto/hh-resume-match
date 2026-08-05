import { isReadyToParse } from '../../shared/store'
import { json, withApi } from './_lib'

export default withApi(async (_req, session) => {
  const readiness = isReadyToParse(session)
  return json({
    id: session.id,
    resumes: session.resumes,
    config: {
      sheetUrl: session.config.sheetUrl || '',
      query: session.config.query || '',
      remoteOnly: session.config.remoteOnly !== false,
      periodDays: session.config.periodDays || 7,
      maxPages: session.config.maxPages || 5,
    },
    job: session.job,
    ready: readiness.ok,
    missing: readiness.missing,
    saEmail: process.env.PUBLIC_GOOGLE_SA_EMAIL || '',
  })
})
