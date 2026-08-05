import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { v4 as uuid } from 'uuid'
import { emptySession, getSession, saveSession } from '../../shared/store'

export const SESSION_COOKIE = 'hrm_sid'

export function json(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): HandlerResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

export function readSessionId(event: HandlerEvent): string | null {
  const raw = event.headers.cookie || event.headers.Cookie || ''
  const cookies = parseCookie(raw)
  return cookies[SESSION_COOKIE] || null
}

function sessionCookie(id: string): string {
  const secure =
    process.env.CONTEXT === 'production' ||
    process.env.CONTEXT === 'deploy-preview' ||
    process.env.CONTEXT === 'branch-deploy'
  return serializeCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure,
  })
}

export async function requireSession(event: HandlerEvent) {
  let id = readSessionId(event)
  let created = false
  if (!id) {
    id = uuid()
    created = true
  }
  let session = await getSession(id)
  if (!session) {
    session = emptySession(id)
    await saveSession(session)
    created = true
  }
  // Always refresh cookie so it sticks across deploys / first response
  const headers: Record<string, string> = {
    'Set-Cookie': sessionCookie(session.id),
  }
  if (created) {
    // keep flag for debugging if needed
  }
  return { session, headers }
}

export function withCors(handler: Handler): Handler {
  return async (event, context) => {
    const origin = event.headers.origin || event.headers.Origin || '*'
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    }
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors, body: '' }
    }
    try {
      const res = await handler(event, context)
      return {
        ...res,
        headers: {
          ...cors,
          ...(res?.headers || {}),
        },
      }
    } catch (e) {
      return json(500, { error: e instanceof Error ? e.message : String(e) }, cors)
    }
  }
}
