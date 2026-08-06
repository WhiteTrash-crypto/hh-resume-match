import { probeHhAccess } from '../../shared/hh'
import { json, withPublic } from './_lib'

/** Staging/ops probe: can this Netlify egress reach hh.ru search HTML? */
export default withPublic(async () => {
  const result = await probeHhAccess()
  return json(
    {
      ...result,
      time: new Date().toISOString(),
      context: process.env.CONTEXT || null,
    },
    { status: result.ok ? 200 : 503 },
  )
})
