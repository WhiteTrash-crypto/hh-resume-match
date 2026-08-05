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
- score 0–100, fit резюме к вакансии
- domainTier: A (web3/crypto/fintech/edtech/B2B product), B (общий IT product/project), C (далеко)
- Seniority max middle: senior/lead/head/директор/ведущий → score < 50 и redFlags
- Prefer remote/hybrid
- Не выдумывай факты

Верни ТОЛЬКО JSON:
{"score":0,"domainTier":"A|B|C","role":"...","workMode":"remote|hybrid|office|unknown","reason":"...","redFlags":"..."}`
}

export async function scoreVacancy(
  resumeText: string,
  vacancy: Vacancy,
): Promise<AtsResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY не задан')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
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
