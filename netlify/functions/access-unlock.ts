import { unlockAccessKey } from '../../shared/accessKeys'
import { saveSession } from '../../shared/store'
import { json, withApi } from './_lib'

export default withApi(async (req, session) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: { key?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  const result = await unlockAccessKey(body.key || '')
  if (!result.ok) {
    const status = result.code === 'expired' ? 403 : result.code === 'not_configured' ? 503 : 401
    return json(
      {
        error: result.error,
        code: result.code,
        access: { unlocked: false, usesLeft: 0 },
      },
      { status },
    )
  }

  session.access = {
    key: result.key,
    usesLeft: result.usesLeft,
    unlockedAt: new Date().toISOString(),
  }
  await saveSession(session)

  return json({
    ok: true,
    access: {
      unlocked: true,
      usesLeft: result.usesLeft,
    },
  })
})
