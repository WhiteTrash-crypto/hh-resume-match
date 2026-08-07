/**
 * Minimal test runner for the rule-based matcher (no external test framework).
 * Run: npx tsx shared/matcher/__tests__/run.ts
 */
import { normalizeText, fuzzyRatio, includesPhrase } from '../normalize'
import { parseCandidate } from '../parseCandidate'
import { parseVacancy } from '../parseVacancy'
import { scoreMatch } from '../scoring'
import { matchResumeToVacancy } from '../index'
import { detectSections, classifyRequirement } from '../sections'
import { detectSeniority, normalizeTitle, extractYears } from '../matchers/title'
import type { Vacancy } from '../../types'

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1
    console.log(`  OK  ${msg}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${msg}`)
  }
}

function assertRange(n: number, min: number, max: number, msg: string): void {
  assert(n >= min && n <= max, `${msg} (got ${n}, want ${min}-${max})`)
}

function vac(partial: Partial<Vacancy> & { title: string; content: string }): Vacancy {
  return {
    vacancyId: partial.vacancyId || 'job_1',
    url: partial.url || 'https://hh.ru/vacancy/1',
    title: partial.title,
    employer: partial.employer || 'Example',
    location: partial.location || '',
    salary: partial.salary || '',
    experience: partial.experience || '',
    schedule: partial.schedule || '',
    snippet: partial.snippet || '',
    content: partial.content,
  }
}

console.log('Unit: normalize')
assert(normalizeText('  Hello   WORLD  ') === 'hello world', 'lowercase + whitespace')
assert(includesPhrase('Experience with Google Analytics 4', 'ga4') === false, 'ga4 not in long form without alias pass')
assert(fuzzyRatio('amplitude', 'amplitude') === 100, 'fuzzy exact')
assert(extractYears('5+ years of experience').minimum === 5, 'years 5+')
assert(detectSeniority('Senior Product Manager') === 'senior', 'seniority senior')
assert(normalizeTitle('Product Owner').id === 'product_manager', 'PO → product_manager')
assert(normalizeTitle('Frontend Developer').id === 'frontend_engineer', 'FE title')
assert(normalizeTitle('Backend Engineer').id === 'backend_engineer', 'BE title')

console.log('Unit: sections + markers')
const secs = detectSections(`Requirements:\nSQL required\n\nNice to have:\nAmplitude\n`)
assert(Boolean(secs.requirements), 'requirements section')
assert(classifyRequirement('Fluent Mandarin is required') === 'required', 'required marker')
assert(classifyRequirement('Amplitude is a plus') === 'preferred', 'preferred marker')

console.log('Case A: strong PM crypto match')
{
  const resume = `
Product Manager
4 years relevant experience
Crypto, fintech
Skills: GA4, Firebase Analytics, Jira
Roadmap, backlog, analytics, integrations
English B2
`
  const vacancy = vac({
    title: 'Senior Product Owner',
    experience: '3+ years product experience',
    schedule: 'Remote',
    content: `
Responsibilities:
Own roadmap and backlog
Stakeholder management

Requirements:
FinTech experience
Experience with product analytics
3+ years product experience
English B2

Nice to have:
Amplitude is a plus
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Product Manager'], { debug: true })
  assert(!r.rejected, 'A not rejected')
  assert(r.dimensions.role >= 90, `A role >= 90 (got ${r.dimensions.role})`)
  assertRange(r.dimensions.seniority, 75, 100, 'A seniority')
  assert(r.dimensions.experience === 100, `A experience 100 (got ${r.dimensions.experience})`)
  assert(r.dimensions.domain >= 80, `A domain >= 80 (got ${r.dimensions.domain})`)
  assert(r.dimensions.responsibilities >= 70, `A resp >= 70 (got ${r.dimensions.responsibilities})`)
  assert(r.dimensions.skills >= 60, `A skills >= 60 (got ${r.dimensions.skills})`)
  assert(r.score >= 70, `A final >= 70 (got ${r.score})`)
  assert(
    !r.missing_required.some((m) => m.requirement === 'amplitude'),
    'A amplitude not required miss',
  )
}

console.log('Case B: Mandarin hard reject')
{
  const resume = `
Product Manager
English C1
Remote only
No Chinese, no Mandarin
`
  const vacancy = vac({
    title: 'Product Manager',
    schedule: 'Remote worldwide',
    content: `
Requirements:
Fluent Mandarin is required
English preferred
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  assert(r.rejected, 'B rejected')
  assert(
    r.hard_filter_reasons.some((x) => x.rule === 'required_language'),
    'B reason required_language',
  )
}

console.log('Case C: Head of Product low score')
{
  const resume = `
Product Manager
4 years relevant experience
No direct reports
Individual contributor
`
  const vacancy = vac({
    title: 'Head of Product',
    experience: '8+ years',
    content: `
Responsibilities:
Manage a team of 12 product managers
Hire and develop team
Own P&L

Requirements:
8+ years experience
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  assert(!r.rejected || r.score < 50, 'C not hard-reject-or-low')
  assert(r.score < 50, `C score < 50 (got ${r.score})`)
  assert(r.dimensions.management < 50, `C management low (got ${r.dimensions.management})`)
}

console.log('Case D: Mixpanel ↔ analytics tools')
{
  const resume = `
Product Manager
GA4
Firebase Analytics
`
  const vacancy = vac({
    title: 'Product Manager',
    content: `
Requirements:
Experience with Mixpanel or similar product analytics tools
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  assert(!r.rejected, 'D not rejected')
  assert(
    r.matched.some((m) => m.type === 'skill' && (m.credit || 0) >= 0.4) ||
      r.dimensions.skills >= 50,
    `D partial analytics match (skills=${r.dimensions.skills})`,
  )
  assert(
    !r.missing_required.some((m) => m.requirement === 'mixpanel' && (m as { critical?: boolean })),
    'D no critical mixpanel miss forcing reject',
  )
}

console.log('Case E: SQL mandatory miss')
{
  const resume = `
Product Manager
GA4
Firebase
No SQL experience
`
  const vacancy = vac({
    title: 'Product Manager',
    content: `
Requirements:
Advanced SQL is mandatory
Experience with Amplitude is a plus
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  assert(!r.rejected, 'E not hard rejected by default')
  assert(
    r.missing_required.some((m) => m.requirement === 'sql'),
    'E missing sql required',
  )
  assert(
    r.missing_preferred.some((m) => m.requirement === 'amplitude') ||
      !r.missing_required.some((m) => m.requirement === 'amplitude'),
    'E amplitude preferred not required',
  )
}

console.log('Multi-role: frontend keys vs backend vacancy')
{
  const resume = `
Frontend Developer
React, TypeScript, Next.js
5 years experience
`
  const vacancy = vac({
    title: 'Backend Engineer (Java)',
    content: `
Requirements:
Java, Spring Boot, PostgreSQL
5+ years backend experience
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Frontend Developer', 'React'])
  assert(r.dimensions.role <= 35, `FE vs BE role low (got ${r.dimensions.role})`)
  assert(r.score < 55, `FE vs BE score low (got ${r.score})`)
}

console.log('Multi-role: backend match')
{
  const resume = `
Backend Developer
Java, Spring, PostgreSQL, Docker
6 years experience
`
  const vacancy = vac({
    title: 'Senior Backend Engineer',
    experience: '5+ years',
    content: `
Requirements:
Java required
Spring Boot
PostgreSQL
Docker is a plus
`,
  })
  const r = matchResumeToVacancy(resume, vacancy, ['Backend Developer'])
  assert(!r.rejected, 'BE not rejected')
  assert(r.dimensions.role >= 80, `BE role high (got ${r.dimensions.role})`)
  assert(r.score >= 65, `BE score decent (got ${r.score})`)
}

console.log('Parser: search keys drive target roles')
{
  const p = parseCandidate('Software engineer with Python', ['Backend Developer'])
  assert(p.target_roles.includes('backend_engineer'), 'keys → backend_engineer')
}

console.log('Vacancy parse: skills classification')
{
  const v = parseVacancy(
    vac({
      title: 'Product Manager',
      content: 'Requirements:\nSQL is required\n\nNice to have:\nAmplitude would be a plus\n',
    }),
  )
  const sql = v.skills.find((s) => s.id === 'sql')
  const amp = v.skills.find((s) => s.id === 'amplitude')
  assert(Boolean(sql), 'parsed sql')
  assert(sql?.requirement_type === 'required' || classifyRequirement('SQL is required') === 'required', 'sql required')
  assert(Boolean(amp), 'parsed amplitude')
}

console.log('Determinism')
{
  const resume = 'Product Manager\nGA4\nCrypto\nEnglish B2'
  const vacancy = vac({
    title: 'Product Owner Wallet',
    content: 'Requirements:\nFinTech\nProduct analytics\nEnglish B2\n',
  })
  const a = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  const b = matchResumeToVacancy(resume, vacancy, ['Product Manager'])
  assert(a.score === b.score && a.band === b.band, 'same inputs → same score')
}

// Extra golden-ish cases for breadth
const extras: Array<{ name: string; resume: string; keys: string[]; v: Vacancy; check: (r: ReturnType<typeof matchResumeToVacancy>) => boolean }> = [
  {
    name: 'designer match',
    resume: 'Product Designer\nFigma\nUser research\n',
    keys: ['Product Designer'],
    v: vac({
      title: 'UX/UI Designer',
      content: 'Requirements:\nFigma\nUser research\n',
    }),
    check: (r) => r.dimensions.role >= 80 && r.score >= 60,
  },
  {
    name: 'qa match',
    resume: 'QA Engineer\nSelenium\nCypress\n',
    keys: ['QA Engineer'],
    v: vac({ title: 'Automation QA', content: 'Requirements:\nSelenium\nTest automation\n' }),
    check: (r) => r.dimensions.role >= 80,
  },
  {
    name: 'devops match',
    resume: 'DevOps\nKubernetes\nAWS\nDocker\n',
    keys: ['DevOps'],
    v: vac({ title: 'SRE / Platform Engineer', content: 'Requirements:\nKubernetes\nAWS\n' }),
    check: (r) => r.dimensions.role >= 80 && r.score >= 60,
  },
  {
    name: 'data analyst',
    resume: 'Data Analyst\nSQL\nTableau\nExcel\n',
    keys: ['Data Analyst'],
    v: vac({ title: 'Data Analyst', content: 'Requirements:\nSQL required\nTableau\n' }),
    check: (r) => r.score >= 70,
  },
  {
    name: 'marketing',
    resume: 'Marketing Manager\nAcquisition\nSMM\n',
    keys: ['Marketing'],
    v: vac({ title: 'Digital Marketing Manager', content: 'Responsibilities:\nAcquisition\n' }),
    check: (r) => r.dimensions.role >= 80,
  },
  {
    name: 'crypto domain',
    resume: 'Product Manager\nCrypto wallet\nWeb3\n',
    keys: ['Product Manager'],
    v: vac({ title: 'Product Manager', content: 'About: crypto wallet web3 company\nRequirements:\nCrypto experience preferred\n' }),
    check: (r) => r.dimensions.domain >= 80,
  },
  {
    name: 'unrelated sales vs eng',
    resume: 'Sales Manager\nAccount management\n',
    keys: ['Sales Manager'],
    v: vac({ title: 'Java Backend Developer', content: 'Requirements:\nJava\nSpring\n' }),
    check: (r) => r.score < 50,
  },
  {
    name: 'fullstack soft match frontend',
    resume: 'Fullstack Developer\nReact\nNode.js\n',
    keys: ['Fullstack Developer'],
    v: vac({ title: 'Frontend Engineer', content: 'Requirements:\nReact\nTypeScript\n' }),
    check: (r) => r.dimensions.role >= 50,
  },
  {
    name: 'mobile flutter',
    resume: 'Mobile Developer\nFlutter\nDart\n',
    keys: ['Flutter Developer'],
    v: vac({ title: 'Flutter Developer', content: 'Requirements:\nFlutter\nDart\n' }),
    check: (r) => r.score >= 70,
  },
  {
    name: 'project manager',
    resume: 'Project Manager\nJira\nScrum\nStakeholder management\n',
    keys: ['Project Manager'],
    v: vac({
      title: 'Project Manager',
      content: 'Responsibilities:\nManage projects\nStakeholder management\nRequirements:\nJira\nAgile\n',
    }),
    check: (r) => r.score >= 65,
  },
]

console.log('Extra multi-role golden')
for (const ex of extras) {
  const r = matchResumeToVacancy(ex.resume, ex.v, ex.keys)
  assert(ex.check(r), `${ex.name} (score=${r.score} role=${r.dimensions.role})`)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
