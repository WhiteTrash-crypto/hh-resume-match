import type { Handler } from '@netlify/functions'
import Busboy from 'busboy'
import { Readable } from 'node:stream'
import pdf from 'pdf-parse'
import { v4 as uuid } from 'uuid'
import { saveSession } from '../../shared/store'
import { json, requireSession, withCors } from './_lib'

function parseMultipart(
  event: Parameters<Handler>[0],
): Promise<{ filename: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type']
    if (!contentType) {
      reject(new Error('Content-Type отсутствует'))
      return
    }
    const bb = Busboy({ headers: { 'content-type': contentType } })
    let filename = 'resume.pdf'
    const chunks: Buffer[] = []

    bb.on('file', (_name, file, info) => {
      filename = info.filename || filename
      file.on('data', (d: Buffer) => chunks.push(d))
    })
    bb.on('error', reject)
    bb.on('finish', () => resolve({ filename, buffer: Buffer.concat(chunks) }))

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8')
    Readable.from(body).pipe(bb)
  })
}

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
    const { filename, buffer } = await parseMultipart(event)
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return json(400, { error: 'Пока поддерживается только PDF' }, headers)
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return json(400, { error: 'Файл больше 8 МБ' }, headers)
    }
    const parsed = await pdf(buffer)
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
