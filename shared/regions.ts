/** HH area ids + fuzzy aliases for user-typed regions. */

export type HhArea = {
  id: string
  name: string
  /** Normalized aliases (no spaces/punct); also matched fuzzily against name. */
  aliases: string[]
}

/**
 * Curated HH areas (ids from https://api.hh.ru/areas/113).
 * Prefer city ids over oblasts when both exist.
 */
export const HH_AREAS: HhArea[] = [
  { id: '113', name: 'Россия', aliases: ['россия', 'рф', 'russia', 'ru', 'всяроссия', 'всерегионы'] },
  { id: '1', name: 'Москва', aliases: ['москва', 'мск', 'moscow', 'москве', 'москвы'] },
  {
    id: '2',
    name: 'Санкт-Петербург',
    aliases: [
      'санктпетербург',
      'петербург',
      'питер',
      'спб',
      'spb',
      'saintpetersburg',
      'stpetersburg',
      'petersburg',
      'ленинград',
    ],
  },
  { id: '2019', name: 'Московская область', aliases: ['московскаяобласть', 'подмосковье', 'мо'] },
  {
    id: '145',
    name: 'Ленинградская область',
    aliases: ['ленинградскаяобласть', 'ло', 'ленобласть'],
  },
  { id: '3', name: 'Екатеринбург', aliases: ['екатеринбург', 'екб', 'ебург', 'свердловск', 'yekaterinburg'] },
  { id: '4', name: 'Новосибирск', aliases: ['новосибирск', 'нск', 'новосиб'] },
  { id: '66', name: 'Нижний Новгород', aliases: ['нижнийновгород', 'нижний', 'нновгород', 'нн'] },
  { id: '88', name: 'Казань', aliases: ['казань', 'kazan'] },
  { id: '104', name: 'Челябинск', aliases: ['челябинск', 'челяба'] },
  { id: '76', name: 'Ростов-на-Дону', aliases: ['ростовнадону', 'ростов', 'ростовдон'] },
  { id: '53', name: 'Краснодар', aliases: ['краснодар', 'кдр'] },
  { id: '78', name: 'Самара', aliases: ['самара'] },
  { id: '99', name: 'Уфа', aliases: ['уфа'] },
  { id: '72', name: 'Пермь', aliases: ['пермь'] },
  { id: '26', name: 'Воронеж', aliases: ['воронеж'] },
  { id: '24', name: 'Волгоград', aliases: ['волгоград'] },
  { id: '54', name: 'Красноярск', aliases: ['красноярск'] },
  { id: '95', name: 'Тюмень', aliases: ['тюмень'] },
  { id: '68', name: 'Омск', aliases: ['омск'] },
  { id: '79', name: 'Саратов', aliases: ['саратов'] },
  { id: '22', name: 'Владивосток', aliases: ['владивосток', 'влад'] },
  { id: '102', name: 'Хабаровск', aliases: ['хабаровск'] },
  { id: '35', name: 'Иркутск', aliases: ['иркутск'] },
  { id: '11', name: 'Барнаул', aliases: ['барнаул'] },
  { id: '90', name: 'Томск', aliases: ['томск'] },
  { id: '41', name: 'Калининград', aliases: ['калининград', 'кёнигсберг', 'кенигсберг'] },
  { id: '64', name: 'Мурманск', aliases: ['мурманск'] },
  { id: '112', name: 'Ярославль', aliases: ['ярославль'] },
  { id: '92', name: 'Тула', aliases: ['тула'] },
  { id: '43', name: 'Калуга', aliases: ['калуга'] },
  { id: '89', name: 'Тверь', aliases: ['тверь'] },
  { id: '17', name: 'Белгород', aliases: ['белгород'] },
  { id: '56', name: 'Курск', aliases: ['курск'] },
  { id: '58', name: 'Липецк', aliases: ['липецк'] },
  { id: '71', name: 'Пенза', aliases: ['пенза'] },
  { id: '77', name: 'Рязань', aliases: ['рязань'] },
  { id: '19', name: 'Брянск', aliases: ['брянск'] },
  { id: '83', name: 'Смоленск', aliases: ['смоленск'] },
  { id: '23', name: 'Владимир', aliases: ['владимир'] },
  { id: '25', name: 'Вологда', aliases: ['вологда'] },
  { id: '52', name: 'Кострома', aliases: ['кострома'] },
  { id: '14', name: 'Архангельск', aliases: ['архангельск'] },
  { id: '15', name: 'Астрахань', aliases: ['астрахань'] },
  { id: '96', name: 'Ижевск', aliases: ['ижевск'] },
  { id: '107', name: 'Чебоксары', aliases: ['чебоксары'] },
  { id: '98', name: 'Ульяновск', aliases: ['ульяновск'] },
  { id: '84', name: 'Ставрополь', aliases: ['ставрополь'] },
  { id: '29', name: 'Махачкала', aliases: ['махачкала'] },
  { id: '105', name: 'Грозный', aliases: ['грозный'] },
  { id: '130', name: 'Севастополь', aliases: ['севастополь'] },
  { id: '131', name: 'Симферополь', aliases: ['симферополь'] },
  { id: '237', name: 'Сочи', aliases: ['сочи'] },
  { id: '1454', name: 'Новороссийск', aliases: ['новороссийск'] },
  { id: '212', name: 'Тольятти', aliases: ['тольятти', 'тольяти'] },
  { id: '1399', name: 'Магнитогорск', aliases: ['магнитогорск', 'магнитка'] },
  { id: '1381', name: 'Сургут', aliases: ['сургут'] },
  { id: '1641', name: 'Набережные Челны', aliases: ['набережныечелны', 'челны', 'набчелны'] },
  { id: '1753', name: 'Череповец', aliases: ['череповец'] },
]

export const DEFAULT_AREA_ID = '113'
export const MAX_REGIONS = 8

export type ResolvedRegion = {
  input: string
  id: string
  name: string
}

export type ResolveRegionsResult = {
  resolved: ResolvedRegion[]
  /** Unique HH area ids for the search URL */
  areaIds: string[]
  unresolved: string[]
}

export function normalizeRegionToken(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/й/g, 'и') // питер/…; soft matching
    .replace(/[^a-zа-я0-9]+/gi, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1
    for (let j = 0; j < b.length; j++) {
      const cur = a[i] === b[j] ? row[j] : Math.min(row[j], row[j + 1], prev) + 1
      row[j] = prev
      prev = cur
    }
    row[b.length] = prev
  }
  return row[b.length]
}

function scoreMatch(token: string, candidate: string): number {
  if (!token || !candidate) return 0
  if (token === candidate) return 100
  if (candidate.startsWith(token) && token.length >= 3) return 90
  if (token.startsWith(candidate) && candidate.length >= 3) return 85
  if (candidate.includes(token) && token.length >= 4) return 75
  if (token.includes(candidate) && candidate.length >= 4) return 70
  const maxLen = Math.max(token.length, candidate.length)
  if (maxLen < 4) return 0
  const dist = levenshtein(token, candidate)
  const allowed = maxLen <= 5 ? 1 : maxLen <= 8 ? 2 : 3
  if (dist <= allowed) return 60 - dist * 5
  return 0
}

export function resolveRegionToken(raw: string): ResolvedRegion | null {
  const input = (raw || '').trim().replace(/\s+/g, ' ')
  if (!input) return null
  const token = normalizeRegionToken(input)
  if (!token) return null

  let best: { area: HhArea; score: number } | null = null
  for (const area of HH_AREAS) {
    const nameNorm = normalizeRegionToken(area.name)
    let s = scoreMatch(token, nameNorm)
    for (const alias of area.aliases) {
      s = Math.max(s, scoreMatch(token, normalizeRegionToken(alias)))
    }
    if (s > 0 && (!best || s > best.score)) best = { area, score: s }
  }
  if (!best || best.score < 55) return null
  return { input, id: best.area.id, name: best.area.name }
}

/** Parse comma-separated region string → HH area ids. Empty → all Russia. */
export function resolveRegions(raw: string): ResolveRegionsResult {
  const parts = (raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

  if (!parts.length) {
    return {
      resolved: [{ input: '', id: DEFAULT_AREA_ID, name: 'Россия' }],
      areaIds: [DEFAULT_AREA_ID],
      unresolved: [],
    }
  }

  const resolved: ResolvedRegion[] = []
  const unresolved: string[] = []
  const seenIds = new Set<string>()

  for (const part of parts.slice(0, MAX_REGIONS)) {
    const hit = resolveRegionToken(part)
    if (!hit) {
      unresolved.push(part)
      continue
    }
    if (seenIds.has(hit.id)) continue
    seenIds.add(hit.id)
    resolved.push(hit)
  }

  return {
    resolved,
    areaIds: resolved.map((r) => r.id),
    unresolved,
  }
}

export function parseRegionInputs(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of (raw || '').split(',')) {
    const q = part.trim().replace(/\s+/g, ' ')
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length >= MAX_REGIONS) break
  }
  return out
}
