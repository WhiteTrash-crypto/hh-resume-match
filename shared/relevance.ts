import type { Vacancy } from './types'

/** Role-family buckets (open ATS practice: title family match before skills). */
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
    'бэкенд',
    'бекенд',
    'backend engineer',
    'backend developer',
    'software engineer',
    'разработчик',
    'программист',
  ],
  ['frontend', 'front-end', 'фронтенд', 'frontend developer', 'frontend engineer'],
  ['fullstack', 'full-stack', 'full stack', 'фулстек'],
  ['data scientist', 'data science', 'машинное обучение', 'ml engineer', 'дата саентист'],
  ['data analyst', 'аналитик данных', 'бизнес-аналитик', 'business analyst'],
  ['qa', 'тестировщик', 'quality assurance', 'sdet'],
  ['devops', 'sre', 'platform engineer', 'infrastructure'],
  ['designer', 'ux', 'ui', 'дизайнер', 'product designer'],
  ['marketing', 'маркетолог', 'growth', 'smm'],
  ['sales', 'продаж', 'account manager', 'менеджер по продажам', 'менеджер продаж'],
  ['hr', 'рекрутер', 'people', 'кадр'],
  ['android', 'ios', 'mobile', 'мобильн'],
]

const STOP = new Set([
  'and', 'the', 'for', 'with', 'from', 'this', 'that', 'или', 'для', 'при', 'как',
  'что', 'это', 'все', 'года', 'лет', 'опыт', 'работы', 'работа', 'удаленн', 'удалённ',
  'remote', 'офис', 'гибрид', 'full', 'time', 'hh', 'ru',
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

function familyIdsFor(text: string): number[] {
  const n = normalizeText(text)
  const ids: number[] = []
  for (let i = 0; i < ROLE_FAMILIES.length; i++) {
    if (ROLE_FAMILIES[i].some((alias) => n.includes(normalizeText(alias)))) ids.push(i)
  }
  return ids
}

export type QueryRelevance = {
  /** 0–100 */
  score: number
  matchedQuery: string
  detail: string
}

/**
 * How well vacancy title/body matches the user's search keys.
 * Inspired by ATS title-family matching (Resume Optimizer / Affinda):
 * wrong role family → near-zero, regardless of skill keyword overlap.
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
    const qFamilies = familyIdsFor(q)

    let score = 0
    const notes: string[] = []

    if (title.includes(nq)) {
      score = 100
      notes.push('exact_title')
    } else {
      const inTitle = qTokens.filter((t) => title.includes(t)).length
      const inBody = qTokens.filter((t) => body.includes(t)).length
      if (qTokens.length) {
        const titleRatio = inTitle / qTokens.length
        const bodyRatio = inBody / qTokens.length
        score = Math.round(titleRatio * 70 + bodyRatio * 20)
        notes.push(`tokens title=${inTitle}/${qTokens.length} body=${inBody}/${qTokens.length}`)
      }
    }

    if (qFamilies.length && titleFamilies.length) {
      const overlap = qFamilies.some((id) => titleFamilies.includes(id))
      if (overlap) {
        score = Math.max(score, 80)
        notes.push('role_family_match')
      } else {
        // Explicit conflict: e.g. query=product, title=backend engineer
        score = Math.min(score, 15)
        if (score < 10) score = 10
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
export const QUERY_RELEVANCE_MIN = 45
