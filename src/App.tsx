import { useCallback, useEffect, useMemo, useState } from 'react'
import { extractPdfText } from './pdfText'

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
    regions: string
    remoteOnly: boolean
    periodDays: number
    maxPages: number
  }
  job: Job
  ready: boolean
  missing: string[]
  saEmail: string
}

const MAX_KEYS = 5

const empty: SessionPayload = {
  resumes: [],
  config: {
    sheetUrl: '',
    query: '',
    regions: '',
    remoteOnly: true,
    periodDays: 7,
    maxPages: 0,
  },
  job: { status: 'idle', message: 'Ожидание запуска' },
  ready: false,
  missing: ['резюме', 'ссылка на Google Sheet'],
  saEmail: import.meta.env.VITE_GOOGLE_SA_EMAIL || '',
}

function countKeys(raw: string): number {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean).length
}

function isValidSheetUrl(raw: string): boolean {
  const v = raw.trim()
  if (!v) return false
  if (/^https?:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/i.test(v)) return true
  if (/^[a-zA-Z0-9-_]{30,}$/.test(v)) return true
  return false
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
  const [query, setQuery] = useState('')
  const [regions, setRegions] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(true)
  const [sheetTouched, setSheetTouched] = useState(false)
  const [queryTouched, setQueryTouched] = useState(false)

  const queryKeyCount = useMemo(() => countKeys(query), [query])
  const queryTooMany = queryKeyCount > MAX_KEYS
  const queryEmpty = !query.trim()
  const sheetInvalid = sheetTouched && !isValidSheetUrl(sheetUrl)
  const queryInvalid = queryTouched && (queryEmpty || queryTooMany)
  const formValid =
    isValidSheetUrl(sheetUrl) && !queryEmpty && !queryTooMany && session.resumes.length > 0

  const refresh = useCallback(async () => {
    const data = await api<SessionPayload>('session')
    setSession(data)
    setSheetUrl(data.config.sheetUrl || '')
    setQuery(data.config.query || '')
    setRegions(data.config.regions || '')
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
          await refresh()
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
      const text = await extractPdfText(file)
      if (text.length < 80) {
        throw new Error('В PDF слишком мало текста (нужно ≥ 80 символов)')
      }
      const result = await api<{ resumes: Resume[] }>('resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, text }),
      })
      setSession((s) => ({ ...s, resumes: result.resumes }))
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

  function assertClientValid() {
    setSheetTouched(true)
    setQueryTouched(true)
    if (!isValidSheetUrl(sheetUrl)) {
      throw new Error('Вставьте корректную ссылку на Google Sheet')
    }
    if (!query.trim()) {
      throw new Error('Укажите хотя бы один поисковый ключ')
    }
    if (countKeys(query) > MAX_KEYS) {
      throw new Error('Не более 5 запросов')
    }
  }

  async function onStart() {
    setBusy(true)
    setError('')
    try {
      assertClientValid()
      await api('config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetUrl,
          query,
          regions,
          remoteOnly,
          periodDays: 7,
        }),
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
          <p className="hint">До 5 PDF. Текст извлекается в браузере для ATS-скоринга.</p>
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
          <div>
            <label>
              Ссылка на таблицу
              <input
                type="url"
                className={sheetInvalid ? 'invalid' : undefined}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                onBlur={() => setSheetTouched(true)}
                required
              />
            </label>
            {sheetInvalid && (
              <p className="field-error">Нужна ссылка вида docs.google.com/spreadsheets/d/…</p>
            )}
            <label>
              Поисковые ключи на hh.ru (не более 5)
              <input
                type="text"
                className={queryInvalid ? 'invalid' : undefined}
                placeholder="менеджер по продажам"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (!queryTouched) setQueryTouched(true)
                }}
                onBlur={() => setQueryTouched(true)}
                required
              />
            </label>
            {queryTouched && queryTooMany && (
              <p className="field-error">Не более 5 запросов</p>
            )}
            {queryTouched && queryEmpty && (
              <p className="field-error">Укажите хотя бы один ключ</p>
            )}
            <label>
              Регионы (необязательно, через запятую)
              <input
                type="text"
                placeholder="Москва, СПб, Казань"
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
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
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <h2>3. Запуск</h2>
        {!formValid && (
          <p className="error">
            Не хватает:{' '}
            {[
              !session.resumes.length && 'резюме',
              !isValidSheetUrl(sheetUrl) && 'корректная ссылка на Google Sheet',
              queryEmpty && 'поисковый ключ',
              queryTooMany && 'не более 5 запросов',
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
        <div className="row">
          <button className="btn" disabled={!formValid || busy || running} onClick={onStart}>
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

      <p className="footer">made by Crucian Labs</p>
    </div>
  )
}
