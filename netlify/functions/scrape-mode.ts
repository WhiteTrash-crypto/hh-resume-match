import {
  checkOpsKey,
  clearScrapeModeOverride,
  getScrapeModeInfo,
  parseScrapeMode,
  setScrapeMode,
} from '../../shared/scrapeMode'
import { setBlobsMode } from '../../shared/store'
import { json, withPublic } from './_lib'

/**
 * Runtime scrape mode switch (no redeploy).
 *
 * GET  /api/scrape-mode  → current mode
 * POST /api/scrape-mode  { "mode": "apify"|"fetch"|"browser" }  + header X-Ops-Key
 * POST /api/scrape-mode  { "clear": true }  → drop override, use HH_SCRAPE_MODE env
 */
export default withPublic(async (req) => {
  setBlobsMode(true)

  if (req.method === 'GET') {
    const info = await getScrapeModeInfo()
    return json({
      ...info,
      apifyTokenConfigured: Boolean((process.env.APIFY_TOKEN || '').trim()),
      opsKeyConfigured: Boolean((process.env.HH_OPS_KEY || '').trim()),
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (!checkOpsKey(req)) {
    return json(
      {
        error:
          'Нужен заголовок X-Ops-Key (или Authorization: Bearer) = HH_OPS_KEY из env',
      },
      { status: 401 },
    )
  }

  let body: { mode?: string; clear?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  if (body.clear) {
    await clearScrapeModeOverride()
    const info = await getScrapeModeInfo()
    return json({ ok: true, cleared: true, ...info })
  }

  const mode = parseScrapeMode(body.mode)
  if (!mode) {
    return json(
      { error: 'mode должен быть apify | fetch | browser' },
      { status: 400 },
    )
  }

  if (mode === 'apify' && !(process.env.APIFY_TOKEN || '').trim()) {
    return json(
      { error: 'APIFY_TOKEN не задан — нельзя включить apify' },
      { status: 400 },
    )
  }

  await setScrapeMode(mode)
  const info = await getScrapeModeInfo()
  return json({ ok: true, ...info })
})
