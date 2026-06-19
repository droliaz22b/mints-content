// Normalize tag names on the way in so we don't accumulate duplicates like
// "onion"/"onions" or "tomato"/"Tomatoes". Rules:
//   • trim + collapse whitespace, strip surrounding quotes
//   • Title Case each word
//   • singularize SINGLE-word ingredient tags (onions → Onion, tomatoes → Tomato)
//   • never singularize multi-word tags/phrases (e.g. "no onion garlic",
//     "Green Peas", "Summer Coolers") or anything with digits/parentheses
//   • a small protected set of conventionally-plural words is left as-is

// Words that read better left plural even though they end in "s".
const KEEP_PLURAL = new Set([
  'greens', 'oats', 'sprouts', 'noodles', 'cornflakes', 'molasses', 'chips',
  'fries', 'flakes', 'series', 'news', 'oreos',
])

// Irregular singulars we can't derive with simple rules.
const IRREGULAR: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  knives: 'knife',
}

function singularizeWord(lower: string): string {
  if (lower.length <= 3) return lower
  if (KEEP_PLURAL.has(lower)) return lower
  if (IRREGULAR[lower]) return IRREGULAR[lower]
  if (lower.endsWith('ss')) return lower // glass, grass
  if (lower.endsWith('ies')) return lower.slice(0, -3) + 'y' // berries → berry
  if (lower.endsWith('oes')) return lower.slice(0, -2) // tomatoes → tomato, mangoes → mango
  if (/(ses|xes|zes|ches|shes)$/.test(lower)) return lower.slice(0, -2) // dishes → dish, boxes → box
  if (lower.endsWith('s')) return lower.slice(0, -1) // onions → onion, eggs → egg
  return lower
}

function titleCaseWord(w: string): string {
  if (!w) return w
  // Preserve an existing internal capital (e.g. acronyms) but ensure first is upper.
  return w.charAt(0).toUpperCase() + w.slice(1)
}

// Title-case a string while keeping separators like spaces, hyphens and slashes.
function titleCase(s: string): string {
  return s.replace(/[A-Za-z0-9]+/g, m => titleCaseWord(m.toLowerCase()))
}

export function normalizeTagName(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/^["'\s]+|["'\s]+$/g, '') // strip surrounding quotes/space
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  // Single bare word (letters only) → singularize; otherwise leave word forms alone.
  const isSingleWord = /^[A-Za-z]+$/.test(cleaned)
  const base = isSingleWord ? singularizeWord(cleaned.toLowerCase()) : cleaned
  return titleCase(base)
}

// Normalize a list and drop blanks + case-insensitive duplicates (keeping order).
export function normalizeTagList(tags: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTagName(t)
    if (!n) continue
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}
