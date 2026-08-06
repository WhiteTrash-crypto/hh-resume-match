import OpenAI from 'openai'
import type { AtsResult, Vacancy } from './types'

function buildPrompt(resumeText: string, vacancy: Vacancy): string {
  return `Ты ATS-скорер вакансий HeadHunter для кандидата.

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

Критерии:
- score 0–100: насколько вакансия подходит именно этому резюме (навыки, опыт, роль, домен)
- domainTier: A (сильное совпадение домена/стека с резюме), B (частичное), C (слабое/чужая роль)
- Если в вакансии явно senior/lead/head/директор/ведущий, а в резюме нет такого уровня — снижай score и пиши redFlags
- Prefer remote/hybrid, если кандидат это указывает или режим не критичен
- Не выдумывай факты; опирайся только на резюме и текст вакансии
- Не предпочитай product/project manager, если резюме про другую роль

Верни ТОЛЬКО JSON:
{"score":0,"domainTier":"A|B|C","role":"...","workMode":"remote|hybrid|office|unknown","reason":"...","redFlags":"..."}`
}

const STOP = new Set([
  'and', 'the', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'are',
  'или', 'для', 'при', 'как', 'что', 'это', 'все', 'его', 'ее', 'она', 'они',
  'год', 'лет', 'опыт', 'работы', 'работа', 'обязанности', 'требования',
])

function resumeTokens(resumeText: string): string[] {
  const words = resumeText
    .toLowerCase()
    .match(/[a-zа-яё0-9][a-zа-яё0-9+/.#-]{2,}/gi) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 80) break
  }
  return out
}

/** Keyword overlap scorer when OPENAI_API_KEY is missing. */
function heuristicScore(resumeText: string, vacancy: Vacancy): AtsResult {
  const resume = resumeText.toLowerCase()
  const blob = `${vacancy.title}\n${vacancy.content}`.toLowerCase()
  const title = vacancy.title.toLowerCase()

  let score = 35
  const redFlags: string[] = []

  if (/\b(senior|staff|principal|lead|head|директор|ведущий|синьор|сеньор)\b/i.test(title)) {
    if (!/\b(senior|staff|principal|lead|head|директор|ведущий|синьор|сеньор)\b/i.test(resume)) {
      score -= 20
      redFlags.push('seniority')
    }
  }

  const tokens = resumeTokens(resumeText)
  let hits = 0
  for (const t of tokens) {
    if (blob.includes(t)) {
      hits += 1
      score += 1.5
    }
  }

  // Title words from resume boost harder
  const titleHits = tokens.filter((t) => title.includes(t)).length
  score += Math.min(15, titleHits * 3)

  let domainTier: 'A' | 'B' | 'C' = 'C'
  if (hits >= 12 || titleHits >= 3) {
    domainTier = 'A'
    score += 8
  } else if (hits >= 5 || titleHits >= 1) {
    domainTier = 'B'
    score += 4
  }

  let workMode = 'unknown'
  if (/remote|удал/.test(blob)) workMode = 'remote'
  else if (/hybrid|гибрид/.test(blob)) workMode = 'hybrid'
  else if (/офис|office|полный день/.test(blob)) workMode = 'office'

  if (workMode === 'remote' || workMode === 'hybrid') score += 5

  score = Math.max(0, Math.min(100, Math.round(score)))

  return {
    vacancyId: vacancy.vacancyId,
    score,
    domainTier,
    role: vacancy.title,
    workMode,
    reason: `Эвристический ATS (без OpenAI): пересечение токенов резюме ${hits}, titleHits ${titleHits}, tier ${domainTier}.`,
    redFlags: redFlags.join(', '),
  }
}

export async function scoreVacancy(
  resumeText: string,
  vacancy: Vacancy,
): Promise<AtsResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return heuristicScore(resumeText, vacancy)
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const client = new OpenAI({ apiKey })
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Отвечай только валидным JSON без markdown.' },
      { role: 'user', content: buildPrompt(resumeText, vacancy) },
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
  return {
    vacancyId: vacancy.vacancyId,
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    domainTier: tier === 'A' || tier === 'B' ? tier : 'C',
    role: String(parsed.role || vacancy.title),
    workMode: String(parsed.workMode || 'unknown'),
    reason: String(parsed.reason || ''),
    redFlags: String(parsed.redFlags || ''),
  }
}

export async function scoreVacancies(
  resumeText: string,
  vacancies: Vacancy[],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<AtsResult[]> {
  const out: AtsResult[] = []
  for (let i = 0; i < vacancies.length; i++) {
    out.push(await scoreVacancy(resumeText, vacancies[i]))
    if (onProgress) await onProgress(i + 1, vacancies.length)
  }
  return out
}
