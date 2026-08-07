/** Shared text normalization pipeline (§7). */

export function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/[•●▪◦‣]/g, '-')
    .replace(/(\d+)\s*\+\s*yrs?\b/gi, '$1+ years')
    .replace(/(\d+)\s*yrs?\b/gi, '$1 years')
    .replace(/(\d+)\s*-\s*(\d+)\s*yrs?\b/gi, '$1-$2 years')
    .replace(/(\d+)\s+to\s+(\d+)\s*years?/gi, '$1-$2 years')
    .replace(/[^\p{L}\p{N}+#./'\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of normalizeText(s).split(' ')) {
    const w = raw.trim()
    if (w.length < 2 || seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

/** Word n-grams up to `n` tokens (default 4). */
export function ngrams(tokens: string[], n = 4): string[] {
  const out: string[] = []
  for (let size = 1; size <= n; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      out.push(tokens.slice(i, i + size).join(' '))
    }
  }
  return out
}

export function includesPhrase(haystack: string, phrase: string): boolean {
  const h = normalizeText(haystack)
  const p = normalizeText(phrase)
  if (!p) return false
  // Short tech tokens need word boundaries
  if (p.length <= 3 || p === 'go' || p === 'c' || p === 'r') {
    const re = new RegExp(`(^|[^a-zа-я0-9+#.])${escapeRegExp(p)}([^a-zа-я0-9+#.]|$)`, 'i')
    return re.test(h)
  }
  if (p === 'java') {
    return /(^|[^a-zа-я0-9])java([^a-zа-я0-9]|$)/i.test(h) && !h.includes('javascript')
  }
  return h.includes(p)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Simple dice coefficient on character bigrams for fuzzy fallback. */
export function fuzzyRatio(a: string, b: string): number {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return 0
  if (x === y) return 100
  if (x.length < 3 || y.length < 3) return x === y ? 100 : 0
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2)
      m.set(bg, (m.get(bg) || 0) + 1)
    }
    return m
  }
  const A = bigrams(x)
  const B = bigrams(y)
  let overlap = 0
  for (const [k, v] of A) {
    const bv = B.get(k) || 0
    overlap += Math.min(v, bv)
  }
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0)
  if (!total) return 0
  return Math.round((200 * overlap) / total)
}
