import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import { v4 as uuid } from 'uuid'
import { emptySession, getSession, saveSession } from '../../shared/store'

export const SESSION_COOKIE = 'hrm_sid'

export function json(statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): HandlerResponse {
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
  const headers: Record<string, string> = {}
  if (created) {
    headers['Set-Cookie'] = serializeCookie(SESSION_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === 'production',
    })
  }
  return { session, headers }
}

export function withCors(handler: Handler): Handler {
  return async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': event.headers.origin || '*',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        },
        body: '',
      }
    }
    const res = await handler(event, context)
    return {
      ...res,
      headers: {
        ...(res?.headers || {}),
        'Access-Control-Allow-Origin': event.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      },
    }
  }
}
