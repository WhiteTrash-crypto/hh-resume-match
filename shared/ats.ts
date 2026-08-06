import { normalizeText, scoreQueryRelevance, tokenize } from './relevance'
import type { AtsResult, Vacancy } from './types'

/**
 * Weighted open ATS (Resume Matcher / Affinda / ROP style).
 * LLM scoring is disabled for now — heuristic only.
 *
 * Weights:
 * - query/title alignment ~35%
 * - skills keyword overlap ~40%
 * - seniority ~15%
 * - work mode ~10%
 */

const WEIGHTS = {
  queryTitle: 0.35,
  skills: 0.4,
  seniority: 0.15,
  workMode: 0.1,
} as const

const GENERIC = new Set([
  ...tokenize(
    'team work experience company business project projects развитие компания опыт работа команды команда задачи задача система системы клиент клиенты данные data soft skills communication',
  ),
  'and',
  'the',
  'for',
  'with',
  'you',
  'are',
  'will',
  'our',
  'your',
])

function extractSkillishTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length >= 3 && !GENERIC.has(t))
}

/** Down-weight very common tokens (crude IDF stand-in). */
function tokenWeight(token: string): number {
  if (token.length >= 8) return 1.4
  if (/[+#.]/.test(token) || /\d/.test(token)) return 1.5
  if (token.length <= 3) return 0.5
  return 1
}

function seniorityPenalty(resumeText: string, title: string): { score01: number; flag?: string } {
  const seniorVac =
    /\b(senior|staff|principal|lead|head|директор|ведущий|синьор|сеньор|chief)\b/i.test(title)
  const seniorResume =
    /\b(senior|staff|principal|lead|head|директор|ведущий|синьор|сеньор|chief)\b/i.test(
      resumeText,
    )
  if (seniorVac && !seniorResume) return { score01: 0.25, flag: 'seniority' }
  if (!seniorVac && seniorResume) return { score01: 0.85 }
  return { score01: 1 }
}

function workModeScore01(vacancy: Vacancy, resumeText: string): { score01: number; mode: string } {
  const blob = `${vacancy.schedule} ${vacancy.content}`.toLowerCase()
  let mode = 'unknown'
  if (/remote|удал/.test(blob)) mode = 'remote'
  else if (/hybrid|гибрид/.test(blob)) mode = 'hybrid'
  else if (/офис|office|полный день/.test(blob)) mode = 'office'

  const wantsRemote = /remote|удал|гибрид|hybrid/i.test(resumeText)
  if (mode === 'remote' || mode === 'hybrid') return { score01: 1, mode }
  if (mode === 'office' && wantsRemote) return { score01: 0.35, mode }
  if (mode === 'office') return { score01: 0.55, mode }
  return { score01: 0.5, mode }
}

function heuristicScore(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[],
): AtsResult {
  const rel = scoreQueryRelevance(searchQueries, vacancy)
  const queryTitle01 = rel.score / 100

  const resumeSkills = extractSkillishTokens(resumeText).slice(0, 100)
  const jobSkills = new Set(extractSkillishTokens(`${vacancy.title}\n${vacancy.content}`))
  let hitWeight = 0
  let maxWeight = 0
  let hits = 0
  for (const t of resumeSkills) {
    const w = tokenWeight(t)
    maxWeight += w
    if (jobSkills.has(t) || normalizeText(vacancy.content).includes(t)) {
      hitWeight += w
      hits += 1
    }
  }
  const skills01 = maxWeight > 0 ? Math.min(1, hitWeight / (maxWeight * 0.35)) : 0

  const sen = seniorityPenalty(resumeText, vacancy.title)
  const wm = workModeScore01(vacancy, resumeText)

  let score = Math.round(
    100 *
      (WEIGHTS.queryTitle * queryTitle01 +
        WEIGHTS.skills * skills01 +
        WEIGHTS.seniority * sen.score01 +
        WEIGHTS.workMode * wm.score01),
  )

  // Hard cap: wrong role family cannot enter qualified (≥65)
  if (rel.score < 45) score = Math.min(score, 40)
  else if (rel.score < 60) score = Math.min(score, 58)

  const redFlags: string[] = []
  if (rel.score < 45) redFlags.push('wrong_role')
  if (sen.flag) redFlags.push(sen.flag)

  let domainTier: 'A' | 'B' | 'C' = 'C'
  if (rel.score >= 70 && skills01 >= 0.45) domainTier = 'A'
  else if (rel.score >= 50 && skills01 >= 0.25) domainTier = 'B'

  return {
    vacancyId: vacancy.vacancyId,
    score: Math.max(0, Math.min(100, score)),
    domainTier,
    role: vacancy.title,
    workMode: wm.mode,
    reason: `ATS: query ${rel.score}/100 (${rel.detail}); skills hits=${hits} (${Math.round(skills01 * 100)}%); seniority ${Math.round(sen.score01 * 100)}%; mode ${wm.mode}.`,
    redFlags: redFlags.join(', '),
  }
}

export async function scoreVacancy(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[] = [],
): Promise<AtsResult> {
  return heuristicScore(resumeText, vacancy, searchQueries.filter(Boolean))
}

export async function scoreVacancies(
  resumeText: string,
  vacancies: Vacancy[],
  searchQueries: string[] = [],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<AtsResult[]> {
  const out: AtsResult[] = []
  for (let i = 0; i < vacancies.length; i++) {
    out.push(await scoreVacancy(resumeText, vacancies[i], searchQueries))
    if (onProgress) await onProgress(i + 1, vacancies.length)
  }
  return out
}
