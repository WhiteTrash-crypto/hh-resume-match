import type { Vacancy } from './types'

/**
 * Role-family buckets for title matching.
 * Keep aliases specific — never put bare «разработчик» / «developer» here:
 * they match every eng vacancy and wipe out frontend vs backend conflicts.
 */
const ROLE_FAMILIES: string[][] = [
  [
    'product manager',
    'product owner',
    'product management',
    'продакт',
    'менеджер продукта',
    'менеджер по продукту',
    'владелец продукта',
    'продакт-менеджер',
    'продакт менеджер',
  ],
  [
    'project manager',
    'project management',
    'проджект',
    'руководитель проектов',
    'руководитель проекта',
    'менеджер проектов',
    'менеджер проекта',
    'проджект-менеджер',
    'проджект менеджер',
  ],
  [
    'backend',
    'back-end',
    'back end',
    'бэкенд',
    'бекенд',
    'бэкенд-разработ',
    'backend engineer',
    'backend developer',
    'бэкендер',
    'php',
    'python',
    'django',
    'fastapi',
    'flask',
    'java',
    'spring',
    '.net',
    'dotnet',
    'c#',
    'golang',
    'go-разработ',
    ' go разработ',
    'nestjs',
    'nest.js',
    'ruby on rails',
    'laravel',
    'симфони',
    'symfony',
  ],
  [
    'frontend',
    'front-end',
    'front end',
    'фронтенд',
    'фронтэнд',
    'фронт-енд',
    'фронт енд',
    'frontend developer',
    'frontend engineer',
    'front-end developer',
    'фронтенд-разработ',
    'фронтэнд-разработ',
    'react',
    'vue',
    'angular',
    'next.js',
    'nextjs',
    'nuxt',
    'svelte',
  ],
  ['fullstack', 'full-stack', 'full stack', 'фулстек', 'фуллстек'],
  ['data scientist', 'data science', 'машинное обучение', 'ml engineer', 'дата саентист'],
  ['data analyst', 'аналитик данных', 'бизнес-аналитик', 'business analyst'],
  ['qa', 'тестировщик', 'quality assurance', 'sdet'],
  ['devops', 'sre', 'platform engineer', 'infrastructure'],
  ['designer', 'ux', 'ui', 'дизайнер', 'product designer'],
  ['marketing', 'маркетолог', 'growth', 'smm'],
  ['sales', 'продаж', 'account manager', 'менеджер по продажам', 'менеджер продаж'],
  ['hr', 'рекрутер', 'people', 'кадр'],
  ['android', 'ios', 'mobile', 'мобильн', 'flutter', 'react native'],
]

/** Tokens that appear in almost every eng vacancy — ignore for title token scoring. */
const WEAK_QUERY_TOKENS = new Set([
  'разработчик',
  'разработка',
  'программист',
  'developer',
  'engineer',
  'software',
  'junior',
  'middle',
  'senior',
  'ведущий',
  'старший',
])

const STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'или',
  'для',
  'при',
  'как',
  'что',
  'это',
  'все',
  'года',
  'лет',
  'опыт',
  'работы',
  'работа',
  'удаленн',
  'удалённ',
  'remote',
  'офис',
  'гибрид',
  'full',
  'time',
  'hh',
  'ru',
])

export function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}+#./-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of normalizeText(s).split(' ')) {
    const w = raw.trim()
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

function includesAlias(haystack: string, alias: string): boolean {
  const h = normalizeText(haystack)
  const a = normalizeText(alias)
  if (!a) return false
  // Avoid java ⊂ javascript
  if (a === 'java') {
    return /(^|[^a-zа-я0-9])java([^a-zа-я0-9]|$)/i.test(h) && !h.includes('javascript')
  }
  if (a === 'go') {
    return /(^|[^a-zа-я0-9])go([^a-zа-я0-9]|$)/i.test(h) || h.includes('golang')
  }
  return h.includes(a)
}

function familyIdsFor(text: string): number[] {
  const ids: number[] = []
  for (let i = 0; i < ROLE_FAMILIES.length; i++) {
    if (ROLE_FAMILIES[i].some((alias) => includesAlias(text, alias))) ids.push(i)
  }
  return ids
}

function distinctiveQueryTokens(q: string): string[] {
  return tokenize(q).filter((t) => !WEAK_QUERY_TOKENS.has(t))
}

export type QueryRelevance = {
  /** 0–100 */
  score: number
  matchedQuery: string
  detail: string
}

/**
 * How well vacancy title/body matches the user's search keys.
 * Wrong role family (frontend query vs backend title) → near-zero.
 */
export function scoreQueryRelevance(queries: string[], vacancy: Vacancy): QueryRelevance {
  const title = normalizeText(vacancy.title)
  const body = normalizeText(`${vacancy.title} ${vacancy.snippet} ${vacancy.content.slice(0, 1500)}`)
  const titleFamilies = familyIdsFor(vacancy.title)

  let best: QueryRelevance | null = null

  for (const q of queries) {
    const nq = normalizeText(q)
    if (!nq) continue
    const qTokens = tokenize(q)
    const strongTokens = distinctiveQueryTokens(q)
    const qFamilies = familyIdsFor(q)

    let score = 0
    const notes: string[] = []

    if (title.includes(nq)) {
      score = 100
      notes.push('exact_title')
    } else {
      const titlePool = strongTokens.length ? strongTokens : qTokens
      const bodyPool = qTokens
      const inTitle = titlePool.filter((t) => title.includes(t)).length
      const inBody = bodyPool.filter((t) => body.includes(t)).length
      if (titlePool.length) {
        const titleRatio = inTitle / titlePool.length
        const bodyRatio = bodyPool.length ? inBody / bodyPool.length : 0
        // Title distinctive tokens dominate; body alone cannot save a wrong role.
        score = Math.round(titleRatio * 85 + bodyRatio * 10)
        notes.push(
          `tokens title=${inTitle}/${titlePool.length} body=${inBody}/${bodyPool.length}`,
        )
      }
      // Bare «разработчик» in title must not carry a frontend query.
      if (strongTokens.length && inTitle === 0) {
        score = Math.min(score, 20)
        notes.push('no_distinctive_title_token')
      }
    }

    if (qFamilies.length && titleFamilies.length) {
      const overlap = qFamilies.some((id) => titleFamilies.includes(id))
      if (overlap) {
        score = Math.max(score, 80)
        notes.push('role_family_match')
      } else {
        score = Math.min(score, 12)
        notes.push('role_family_conflict')
      }
    } else if (qFamilies.length && !titleFamilies.length) {
      if (score < 40) notes.push('known_query_weak_title')
    }

    const candidate: QueryRelevance = {
      score,
      matchedQuery: q,
      detail: notes.join('; ') || 'ok',
    }
    if (!best || candidate.score > best.score) best = candidate
  }

  return best || { score: 0, matchedQuery: '', detail: 'no_query' }
}

/** Vacancies below this are dropped before expensive ATS scoring. */
export const QUERY_RELEVANCE_MIN = 50
