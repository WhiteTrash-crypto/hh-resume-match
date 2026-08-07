import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { v4 as uuid } from 'uuid'
import {
  emptySession,
  getSession,
  saveSession,
  setBlobsMode,
} from '../../shared/store'
import type { SessionData } from '../../shared/types'

export const SESSION_COOKIE = 'hrm_sid'

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(data), { ...init, headers })
}

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get('origin') || '*'
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Ops-Key',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  })
}

export function withApi(
  handler: (req: Request, session: SessionData) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsHeaders(req)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    try {
      // Functions 2.0: Blobs are auto-configured — mark cloud mode
      setBlobsMode(true)
      const { session, setCookie } = await loadSession(req)
      const res = await handler(req, session)
      const headers = new Headers(res.headers)
      cors.forEach((v, k) => headers.set(k, v))
      headers.append('Set-Cookie', setCookie)
      return new Response(res.body, { status: res.status, headers })
    } catch (e) {
      console.error('api error', e)
      const headers = corsHeaders(req)
      headers.set('Content-Type', 'application/json; charset=utf-8')
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers },
      )
    }
  }
}

async function loadSession(req: Request): Promise<{ session: SessionData; setCookie: string }> {
  const raw = req.headers.get('cookie') || ''
  const cookies = parseCookie(raw)
  let id = cookies[SESSION_COOKIE]
  if (!id) id = uuid()

  let session = await getSession(id)
  if (!session) {
    session = emptySession(id)
    await saveSession(session)
  }

  const secure =
    process.env.CONTEXT === 'production' ||
    process.env.CONTEXT === 'deploy-preview' ||
    process.env.CONTEXT === 'branch-deploy'

  const setCookie = serializeCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure,
  })

  return { session, setCookie }
}

/** Smoke test without session/blobs */
export function withPublic(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsHeaders(req)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    try {
      const res = await handler(req)
      const headers = new Headers(res.headers)
      cors.forEach((v, k) => headers.set(k, v))
      return new Response(res.body, { status: res.status, headers })
    } catch (e) {
      const headers = corsHeaders(req)
      headers.set('Content-Type', 'application/json; charset=utf-8')
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers },
      )
    }
  }
}

// keep import for bundler awareness in local typecheck
export type { SessionData } from '../../shared/types'
