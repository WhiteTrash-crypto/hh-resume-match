import type { Handler } from '@netlify/functions'
import { createRequire } from 'node:module'
import { v4 as uuid } from 'uuid'
import { saveSession } from '../../shared/store'
import { json, requireSession, withCors } from './_lib'

const require = createRequire(import.meta.url)
// pdf-parse is CJS; default import breaks on Netlify esbuild
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

const baseHandler: Handler = async (event) => {
  const { session, headers } = await requireSession(event)

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id
    if (!id) return json(400, { error: 'id обязателен' }, headers)
    session.resumes = session.resumes.filter((r) => r.id !== id)
    delete session.resumeTexts[id]
    await saveSession(session)
    return json(200, { resumes: session.resumes }, headers)
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, headers)
  }

  if (session.resumes.length >= 5) {
    return json(400, { error: 'Максимум 5 резюме на сессию' }, headers)
  }

  try {
    let body: { filename?: string; data?: string }
    try {
      body = JSON.parse(event.body || '{}')
    } catch {
      return json(400, { error: 'Ожидался JSON { filename, data }' }, headers)
    }
    const filename = (body.filename || 'resume.pdf').trim()
    const data = body.data || ''
    if (!data) return json(400, { error: 'Пустой файл' }, headers)
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return json(400, { error: 'Пока поддерживается только PDF' }, headers)
    }

    const b64 = data.includes(',') ? data.split(',')[1] : data
    const buffer = Buffer.from(b64, 'base64')
    if (!buffer.length) return json(400, { error: 'Не удалось прочитать файл' }, headers)
    if (buffer.length > 4.5 * 1024 * 1024) {
      return json(400, { error: 'Файл больше 4.5 МБ (лимит Netlify Functions)' }, headers)
    }

    const parsed = await pdfParse(buffer)
    const text = (parsed.text || '').trim()
    if (text.length < 80) {
      return json(400, { error: 'Не удалось извлечь текст из PDF' }, headers)
    }

    const id = uuid()
    session.resumes.push({
      id,
      filename,
      uploadedAt: new Date().toISOString(),
      chars: text.length,
    })
    session.resumeTexts[id] = text
    await saveSession(session)
    return json(200, { resumes: session.resumes }, headers)
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'Ошибка загрузки' }, headers)
  }
}

export const handler = withCors(baseHandler)
