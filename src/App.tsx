import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

type Resume = { id: string; filename: string; uploadedAt: string; chars: number }
type Job = {
  status: string
  message: string
  error?: string
  stats?: {
    fetched: number
    afterHardFilter: number
    scored: number
    writtenQualified: number
    writtenCandidates: number
  }
}

type SessionPayload = {
  resumes: Resume[]
  config: {
    sheetUrl: string
    query: string
    remoteOnly: boolean
    periodDays: number
    maxPages: number
  }
  job: Job
  ready: boolean
  missing: string[]
  saEmail: string
}

const empty: SessionPayload = {
  resumes: [],
  config: {
    sheetUrl: '',
    query: 'продакт-менеджер',
    remoteOnly: true,
    periodDays: 7,
    maxPages: 1,
  },
  job: { status: 'idle', message: 'Ожидание запуска' },
  ready: false,
  missing: ['резюме', 'ссылка на Google Sheet'],
  saEmail: import.meta.env.VITE_GOOGLE_SA_EMAIL || '',
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    credentials: 'include',
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data as T
}

export default function App() {
  const [session, setSession] = useState<SessionPayload>(empty)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [query, setQuery] = useState('продакт-менеджер')
  const [remoteOnly, setRemoteOnly] = useState(true)

  const refresh = useCallback(async () => {
    const data = await api<SessionPayload>('session')
    setSession(data)
    setSheetUrl(data.config.sheetUrl || '')
    setQuery(data.config.query || 'продакт-менеджер')
    setRemoteOnly(data.config.remoteOnly !== false)
    return data
  }, [])

  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [refresh])

  const running = useMemo(
    () => ['collecting', 'filtering', 'scoring', 'writing'].includes(session.job.status),
    [session.job.status],
  )

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      api<{ job: Job }>('jobs-status')
        .then(async () => {
          const data = await refresh()
          if (data.job.status === 'done' || data.job.status === 'error') {
            /* stop via running memo */
          }
        })
        .catch((e) => setError(e.message))
    }, 2500)
    return () => clearInterval(t)
  }, [running, refresh])

  async function onUpload(file: File | null) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
        reader.readAsDataURL(file)
      })
      const result = await api<{ resumes: Resume[] }>('resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, data }),
      })
      setSession((s) => ({ ...s, resumes: result.resumes, ready: false }))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteResume(id: string) {
    setBusy(true)
    setError('')
    try {
      await api(`resumes?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveConfig(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, query, remoteOnly, periodDays: 7, maxPages: 1 }),
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  async function onStart() {
    setBusy(true)
    setError('')
    try {
      await api('config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, query, remoteOnly, periodDays: 7, maxPages: 1 }),
      })
      await api('jobs-start', { method: 'POST' })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка запуска')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="app">
        <p className="lede">Загрузка сессии…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="hero">
        <h1 className="brand">
          Матч <span>HH</span>
        </h1>
        <p className="lede">
          Загрузите резюме, прикрепите Google Sheet — сервис соберёт вакансии с hh.ru, оценит ATS-fit
          и запишет результат в вашу таблицу. Без регистрации, всё держится на cookie-сессии.
        </p>
      </header>

      <div className="grid two">
        <section className="panel">
          <h2>1. Резюме</h2>
          <p className="hint">До 5 PDF. Текст извлекается на сервере для ATS-скоринга.</p>
          <div className="drop">
            Выберите PDF — загрузка начнётся сразу
            <div>
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  void onUpload(f)
                  e.target.value = ''
                }}
              />
            </div>
            {busy && <p style={{ margin: '0.5rem 0 0' }}>Загрузка…</p>}
          </div>
          {error && (
            <p className="error" style={{ marginTop: 0 }}>
              {error}
            </p>
          )}
          <ul className="list">
            {session.resumes.map((r) => (
              <li key={r.id}>
                <span>
                  {r.filename}
                  <br />
                  <small style={{ color: 'var(--muted)' }}>{r.chars} символов текста</small>
                </span>
                <button className="btn danger" disabled={busy} onClick={() => onDeleteResume(r.id)}>
                  Удалить
                </button>
              </li>
            ))}
            {!session.resumes.length && <li style={{ color: 'var(--muted)' }}>Пока пусто</li>}
          </ul>
        </section>

        <section className="panel">
          <h2>2. Google Sheet</h2>
          <p className="hint">
            Создайте таблицу и выдайте права Редактор на наш service account:
          </p>
          <div className="sa-box mono">{session.saEmail}</div>
          <form onSubmit={onSaveConfig}>
            <label>
              Ссылка на таблицу
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                required
              />
            </label>
            <label>
              Поисковый запрос на hh.ru
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              Только удалёнка
            </label>
            <div className="row">
              <button className="btn ghost" type="submit" disabled={busy}>
                Сохранить настройки
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <h2>3. Запуск</h2>
        <p className="hint">
          Заполните поля и нажмите «Сохранить настройки». Потом — «Начать парсинг».
          Результат: вкладки <code> hh_candidates</code> / <code>hh_qualified</code>.
        </p>
        {!session.ready && (
          <p className="error">Не хватает: {session.missing.join(', ')}</p>
        )}
        <div className="row">
          <button className="btn" disabled={!session.ready || busy || running} onClick={onStart}>
            {running ? 'Идёт обработка…' : 'Начать парсинг'}
          </button>
        </div>
        <div className="status">
          <div>
            Статус: <strong>{session.job.status}</strong> — {session.job.message}
          </div>
          {session.job.stats && (
            <p style={{ margin: '0.55rem 0 0', color: 'var(--muted)' }}>
              Найдено {session.job.stats.fetched}, после фильтра {session.job.stats.afterHardFilter},
              scored {session.job.stats.scored}, в qualified {session.job.stats.writtenQualified}, в
              candidates {session.job.stats.writtenCandidates}
            </p>
          )}
          {session.job.status === 'done' && <p className="ok">Готово — откройте вашу Google Sheet.</p>}
          {session.job.error && <p className="error">{session.job.error}</p>}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <p className="footer">
        Бесплатный MVP · только hh.ru · без аккаунта · сессия в cookie. Не загружайте чужие персональные
        данные без согласия.
      </p>
    </div>
  )
}
