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
npm install
npm run dev   # netlify dev → http://localhost:8888
```

## Env

| Переменная | Назначение |
|---|---|
| `APIFY_TOKEN` | Apify для сбора hh.ru |
| `APIFY_ACTOR` | по умолчанию `abotapi/hh-ru-jobs-scraper` |
| `OPENAI_API_KEY` | ATS-скоринг |
| `OPENAI_MODEL` | по умолчанию `gpt-4o-mini` |
| `GOOGLE_SA_JSON` / `GOOGLE_SA_PATH` | service account |
| `PUBLIC_GOOGLE_SA_EMAIL` / `VITE_GOOGLE_SA_EMAIL` | email для шаринга таблицы |
| `SESSION_SECRET` | резерв под подпись cookie |

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
