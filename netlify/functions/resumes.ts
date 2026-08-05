import { v4 as uuid } from 'uuid'
import { saveSession } from '../../shared/store'
import { json, withApi } from './_lib'

export default withApi(async (req, session) => {
  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return json({ error: 'id обязателен' }, { status: 400 })
    session.resumes = session.resumes.filter((r) => r.id !== id)
    delete session.resumeTexts[id]
    await saveSession(session)
    return json({ resumes: session.resumes })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (session.resumes.length >= 5) {
    return json({ error: 'Максимум 5 резюме на сессию' }, { status: 400 })
  }

  let body: { filename?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Ожидался JSON { filename, text }' }, { status: 400 })
  }

  const filename = (body.filename || 'resume.pdf').trim()
  const text = (body.text || '').trim()
  if (!filename.toLowerCase().endsWith('.pdf')) {
    return json({ error: 'Пока поддерживается только PDF' }, { status: 400 })
  }
  if (text.length < 80) {
    return json(
      { error: 'Слишком мало текста в PDF (нужно ≥ 80 символов)' },
      { status: 400 },
    )
  }
  if (text.length > 200_000) {
    return json({ error: 'Текст резюме слишком большой' }, { status: 400 })
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
  return json({ resumes: session.resumes })
})
