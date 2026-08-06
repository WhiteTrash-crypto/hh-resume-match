import OpenAI from 'openai'
import { normalizeText, scoreQueryRelevance, tokenize } from './relevance'
import type { AtsResult, Vacancy } from './types'

/**
 * Weighted ATS inspired by open criteria (Resume Matcher / Affinda / ROP):
 * - Job title / search-key alignment (critical gate)
 * - Skills keyword overlap (rarer tokens weigh more)
 * - Seniority alignment
 * - Work mode preference
 *
 * Without OpenAI we use the heuristic; with OpenAI the LLM follows the same rubric,
 * then we still apply a hard query-relevance cap so wrong roles cannot qualify.
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

function buildPrompt(resumeText: string, vacancy: Vacancy, searchQueries: string[]): string {
  const q = searchQueries.join(' | ') || '(не заданы)'
  const rel = scoreQueryRelevance(searchQueries, vacancy)
  return `Ты ATS-скорер вакансий HeadHunter.

Поисковые ключи пользователя (целевая роль): ${q}
Совпадение ключей с вакансией (предрасчёт): ${rel.score}/100 (${rel.detail})

Резюме кандидата:
"""
${resumeText.slice(0, 12000)}
"""

Вакансия:
title: ${vacancy.title}
employer: ${vacancy.employer}
location: ${vacancy.location}
salary: ${vacancy.salary}
experience: ${vacancy.experience}
schedule: ${vacancy.schedule}
url: ${vacancy.url}
text:
"""
${vacancy.content.slice(0, 8000)}
"""

Рубрика (как в open-source ATS: title → skills → seniority):
1) Title / role family vs поисковые ключи (вес ~35%). Если роль явно другая семья
   (например ключ product manager, вакансия Backend Engineer) — score ≤ 40, redFlags=wrong_role.
2) Skills overlap резюме ↔ требования вакансии (вес ~40%). Редкие навыки важнее общих слов.
3) Seniority alignment (вес ~15%).
4) Work mode remote/hybrid (вес ~10%), если не противоречит резюме.

domainTier: A сильный fit ключ+скиллы, B частичный, C чужая роль или слабый fit.
Не выдумывай факты.

Верни ТОЛЬКО JSON:
{"score":0,"domainTier":"A|B|C","role":"...","workMode":"remote|hybrid|office|unknown","reason":"...","redFlags":"..."}`
}

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

function applyQueryCap(result: AtsResult, vacancy: Vacancy, searchQueries: string[]): AtsResult {
  const rel = scoreQueryRelevance(searchQueries, vacancy)
  let score = result.score
  const flags = new Set(
    result.redFlags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  if (rel.score < 45) {
    score = Math.min(score, 40)
    flags.add('wrong_role')
  } else if (rel.score < 60) {
    score = Math.min(score, 58)
  }
  const reason = result.reason.includes('query ')
    ? result.reason
    : `${result.reason} | query ${rel.score}/100 (${rel.detail})`
  return {
    ...result,
    score,
    redFlags: [...flags].join(', '),
    reason,
  }
}

export async function scoreVacancy(
  resumeText: string,
  vacancy: Vacancy,
  searchQueries: string[] = [],
): Promise<AtsResult> {
  const queries = searchQueries.filter(Boolean)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return heuristicScore(resumeText, vacancy, queries)
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Отвечай только валидным JSON без markdown.' },
      { role: 'user', content: buildPrompt(resumeText, vacancy, queries) },
    ],
  })
  const raw = completion.choices[0]?.message?.content || '{}'
  let parsed: Partial<AtsResult> & { domainTier?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { score: 0, reason: 'parse_error', redFlags: 'bad_llm_json' }
  }
  const tier = String(parsed.domainTier || 'C').toUpperCase()
  const result: AtsResult = {
    vacancyId: vacancy.vacancyId,
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    domainTier: tier === 'A' || tier === 'B' ? tier : 'C',
    role: String(parsed.role || vacancy.title),
    workMode: String(parsed.workMode || 'unknown'),
    reason: String(parsed.reason || ''),
    redFlags: String(parsed.redFlags || ''),
  }
  return applyQueryCap(result, vacancy, queries)
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
