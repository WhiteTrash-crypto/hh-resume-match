import type { Vacancy } from './types'

const SPAM = [
  'unpaid internship',
  'без оплаты',
  'стажировка без зарплаты',
  'crypto airdrop job',
]

export type HardFilterResult = { ok: true; boosts: string[] } | { ok: false; reason: string }

/**
 * Light post-collect filters only. Role matching is the user's search keys + ATS,
 * not a hardcoded product/project-manager allowlist.
 */
export function applyHardFilters(vacancy: Vacancy): HardFilterResult {
  const text = `${vacancy.title}\n${vacancy.content}`.toLowerCase()

  for (const s of SPAM) {
    if (text.includes(s)) return { ok: false, reason: `spam:${s}` }
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
