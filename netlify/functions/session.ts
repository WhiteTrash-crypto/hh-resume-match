import { peekAccessKey } from '../../shared/accessKeys'
import { isReadyToParse } from '../../shared/store'
import { json, withApi } from './_lib'

export default withApi(async (_req, session) => {
  const readiness = isReadyToParse(session)
  let usesLeft = session.access?.usesLeft ?? 0
  let usesTotal = session.access?.usesTotal ?? 0
  const unlocked = Boolean(session.access?.keyHash)

  if (session.access?.keyHash) {
    const rec = await peekAccessKey(session.access.keyHash)
    if (rec) {
      usesLeft = rec.usesLeft
      usesTotal = rec.usesTotal
    }
  }

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
    access: {
      unlocked,
      usesLeft,
      usesTotal,
    },
  })
})
