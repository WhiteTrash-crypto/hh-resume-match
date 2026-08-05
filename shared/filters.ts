import type { Vacancy } from './types'

const ROLE_PATTERNS = [
  /product manager/i,
  /product owner/i,
  /project manager/i,
  /менеджер продукта/i,
  /менеджер по продукту/i,
  /владелец продукта/i,
  /продакт[- ]?менеджер/i,
  /проджект[- ]?менеджер/i,
  /руководитель проектов/i,
  /\bпродакт\b/i,
  /\bпроджект\b/i,
]

const SENIORITY_PATTERNS = [
  /\bsenior\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\blead product\b/i,
  /\bhead of product\b/i,
  /\bdirector of product\b/i,
  /старший продакт/i,
  /старший product/i,
  /ведущий продакт/i,
  /ведущий менеджер по продукту/i,
  /ведущий менеджер продукта/i,
  /директор по продукту/i,
  /руководитель продукта/i,
  /синьор/i,
  /сеньор/i,
]

const SPAM = [
  'unpaid internship',
  'без оплаты',
  'стажировка без зарплаты',
  'crypto airdrop job',
]

export type HardFilterResult = { ok: true; boosts: string[] } | { ok: false; reason: string }

export function applyHardFilters(vacancy: Vacancy): HardFilterResult {
  const title = vacancy.title.toLowerCase()
  const text = `${vacancy.title}\n${vacancy.content}`.toLowerCase()

  for (const s of SPAM) {
    if (text.includes(s)) return { ok: false, reason: `spam:${s}` }
  }

  if (!ROLE_PATTERNS.some((p) => p.test(text))) {
    return { ok: false, reason: 'no_role_signal' }
  }

  if (SENIORITY_PATTERNS.some((p) => p.test(title))) {
    return { ok: false, reason: 'seniority_too_high' }
  }

  if (/более 6 лет|больше 6 лет|от 6 лет|moreThan6/i.test(vacancy.experience)) {
    return { ok: false, reason: 'experience_too_high' }
  }

  const boosts: string[] = []
  for (const needle of ['web3', 'crypto', 'крипто', 'fintech', 'финтех', 'edtech', 'saas', 'b2b']) {
    if (text.includes(needle)) boosts.push(needle)
  }
  if (/удал|remote|гибрид|hybrid/i.test(`${vacancy.schedule} ${text}`)) {
    boosts.push('remote')
  }
  return { ok: true, boosts }
}
