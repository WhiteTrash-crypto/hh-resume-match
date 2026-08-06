/** Vacancy fetch budget by number of search keys (total for the whole run). */
export const VACANCY_BUDGET_BY_KEYS: Record<number, number> = {
  1: 100,
  2: 120,
  3: 150,
  4: 200,
  5: 250,
}

export const ITEMS_PER_PAGE = 50
export const MAX_KEYS = 5

export function vacancyBudgetForKeyCount(keyCount: number): number {
  const n = Math.max(1, Math.min(MAX_KEYS, Math.floor(keyCount) || 1))
  return VACANCY_BUDGET_BY_KEYS[n] ?? VACANCY_BUDGET_BY_KEYS[MAX_KEYS]
}

/** Split vacancy budget across N keys; sum === total. */
export function distributeVacancyBudget(totalVacancies: number, queryCount: number): number[] {
  const n = Math.max(0, queryCount)
  if (n === 0) return []
  const total = Math.max(0, Math.floor(totalVacancies))
  const base = Math.floor(total / n)
  const rem = total % n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

/** Pages to request from HH/Apify for a vacancy allotment (ceil, min 1 if allotment > 0). */
export function pagesForVacancyAllotment(vacancies: number): number {
  if (vacancies <= 0) return 0
  return Math.max(1, Math.ceil(vacancies / ITEMS_PER_PAGE))
}
