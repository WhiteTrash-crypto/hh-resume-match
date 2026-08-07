# Матч HH

Публичный сервис: резюме → вакансии hh.ru → ATS-скоринг (OpenAI) → ваша Google Sheet.

- Без регистрации (cookie-сессия)
- Несколько PDF-резюме
- Таблицу шарите на наш Google service account
- Хостинг: Netlify (static + functions)

## Быстрый старт локально

```bash
cp .env.example .env
# заполните APIFY_TOKEN, OPENAI_API_KEY, GOOGLE_SA_PATH или GOOGLE_SA_JSON
# HH_SCRAPE_MODE=apify — прод-сбор через Apify (рекомендуется на Netlify)
# локально также: browser (Playwright) или fetch (+ HH_PROXY при VPN-check)
npm install
npm run dev   # netlify dev → http://localhost:8888
```

## Env

| Переменная | Назначение |
|---|---|
| `HH_SCRAPE_MODE` | дефолт сбора: `apify` / `fetch` / `browser` (если нет runtime override) |
| `HH_OPS_KEY` | секрет для `POST /api/scrape-mode` (переключение без редеплоя) |
| `APIFY_TOKEN` | токен Apify (обязателен при `apify`) |
| `APIFY_ACTOR` | актор, по умолчанию `abotapi/hh-ru-jobs-scraper` |
| `HH_PROXY` | опционально: HTTP(S) прокси для `fetch`/`browser` |
| `HH_USER_AGENT` | опционально: User-Agent для запросов к hh.ru |
| `OPENAI_API_KEY` | ATS-скоринг |
| `OPENAI_MODEL` | модель OpenAI для ATS |
| `GOOGLE_SA_JSON` / `GOOGLE_SA_PATH` | service account (на Netlify — JSON) |
| `PUBLIC_GOOGLE_SA_EMAIL` / `VITE_GOOGLE_SA_EMAIL` | email для шаринга таблицы |
| `SESSION_SECRET` | резерв под подпись cookie |
| `ACCESS_KEYS_SHEET_ID` | таблица ключей (A=ключ, B=остаток) + листы usage по каждому ключу |
| `ACCESS_KEYS_SHEET_TAB` | вкладка со списком ключей (по умолчанию `Лист1`) |

На Netlify: `HH_SCRAPE_MODE=apify`, `APIFY_TOKEN`, и `HH_OPS_KEY` (случайная строка). Когда Apify кончится:

```bash
# посмотреть режим
curl -s https://YOUR_SITE/api/scrape-mode

# переключить на fetch (без редеплоя)
curl -s -X POST https://YOUR_SITE/api/scrape-mode \
  -H "Content-Type: application/json" \
  -H "X-Ops-Key: $HH_OPS_KEY" \
  -d '{"mode":"fetch"}'

# вернуть Apify
curl -s -X POST https://YOUR_SITE/api/scrape-mode \
  -H "Content-Type: application/json" \
  -H "X-Ops-Key: $HH_OPS_KEY" \
  -d '{"mode":"apify"}'

# сбросить override → снова брать HH_SCRAPE_MODE из env
curl -s -X POST https://YOUR_SITE/api/scrape-mode \
  -H "Content-Type: application/json" \
  -H "X-Ops-Key: $HH_OPS_KEY" \
  -d '{"clear":true}'
```

Приоритет: runtime override (Blobs) → `HH_SCRAPE_MODE` → `fetch`.

Если Apify падает (нет баланса / quota / FAILED run / нет токена), сбор сам переключается на `fetch`: пишется override в Blobs и текущий job продолжается через HTML. Вернуть Apify — `POST … {"mode":"apify"}` с `X-Ops-Key`.

На каждый успешный старт парсинга в `ACCESS_KEYS_SHEET_ID` пишется строка в лист `usage_log` и в лист с именем ключа: время, поисковые ключи, гео, удалёнка да/нет (резюме не пишутся).

В Netlify UI добавьте те же переменные. Для `GOOGLE_SA_JSON` вставьте весь JSON одной строкой.

## Пользовательский флоу

1. Загрузить PDF резюме
2. Создать Google Sheet → Share → Editor на `PUBLIC_GOOGLE_SA_EMAIL`
3. Вставить ссылку + поисковый запрос
4. «Начать парсинг»
5. Смотреть вкладки `hh_candidates` / `hh_qualified` (score ≥ 65)

## Деплой на Netlify

1. Подключить GitHub-репозиторий
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Functions directory: `netlify/functions`
5. Прописать env

## Ограничения MVP

- Только HH, только RU UI
- До 5 резюме / сессия, до 25 вакансий на прогон (ATS)
- Serverless: скоринг батчами по 3 вакансии за poll
- PDF only
