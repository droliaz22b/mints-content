import { pb } from './pocketbase'
import { aiChat, AI_MODELS } from './ai'
import { normalizeTagList } from './tagNormalize'

// ─── Shared recipe-import logic (used by Import Docs + Review Later) ───────────

export interface Candidate {
  id: string
  sl_no: number
  recipe_name: string
  has_text?: boolean   // recipe already has recipe_copy → potential duplicate
}

export interface AiFormatResult {
  recipe: string
  tags: string[]
  categories: string[]
}

export type CategoryTaxonomy = { group: string; items: string[] }[]

// Load the category taxonomy (grouped) from the categories collection.
export async function loadCategoryTaxonomy(): Promise<CategoryTaxonomy> {
  const recs = await pb.collection('categories').getFullList({ sort: 'group,name', fields: 'name,group' })
  const map = new Map<string, string[]>()
  for (const r of recs as unknown as { name: string; group?: string }[]) {
    const g = r.group || 'Other'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(r.name)
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }))
}

// Strict disambiguation rules shared by import-time and on-demand categorization.
const CATEGORY_RULES = `Hard rules (accuracy matters more than completeness — never assign a category that doesn't clearly fit):
- DISH TYPE: pick the ONE that best describes the finished dish. A cake / pastry / sweet / dessert = "Desserts & Sweets"; a drink = "Beverages & Drinks".
- "Beverages & Drinks" is ONLY for things you DRINK (juice, smoothie, lassi, shake, milkshake, tea, coffee, mocktail). A solid food, cake, pastry, snack or sweet is NEVER "Beverages & Drinks", even if it contains milk, syrup or fruit.
- COOKING METHOD: read the METHOD steps and assign one ONLY if clearly used — oven / "bake" / "preheat and bake" → "Baked"; "air fryer" → "Air Fryer"; pressure cooker / instant pot → "Pressure Cooker / Instant Pot"; "microwave" → "Microwave"; "slow cooker" → "Slow Cooker"; no cooking at all / set in fridge / only mixing → "No-Cook / No-Bake". If it is deep-fried, pan-fried, boiled or steamed, assign NONE of the method categories.
- CUISINE / REGION: only when clearly identifiable.
- DIETARY: "Vegetarian" when there is no meat/fish/egg; "Vegan" only when also no dairy/honey.
- OCCASION / FESTIVAL and SEASON / WEATHER: include ONLY if the recipe is explicitly for that occasion/season.
- Use the EXACT category names from the list. Never invent names. An empty list is correct when nothing clearly applies.`

// Classify a recipe into categories ONLY (no formatting). Uses the recipe text
// when available, otherwise infers conservatively from the name. Returns
// validated category names from the taxonomy (empty when nothing clearly fits).
export async function classifyRecipeCategories(
  recipeName: string, recipeText: string, taxonomy: CategoryTaxonomy
): Promise<string[]> {
  if (!taxonomy.length) return []
  const list = taxonomy.map(g => `${g.group}: ${g.items.join(', ')}`).join('\n')
  const hasText = recipeText.trim().length > 0
  const system = `You are an expert recipe categorizer for Mints Recipes. Choose categories ONLY from the allowed list.
${CATEGORY_RULES}
${hasText ? '' : 'No recipe text is provided — infer ONLY the obvious dish type (and cuisine if obvious) from the name; leave cooking method, dietary, occasion and season empty unless certain.\n'}
Worked example: "Mango Suji Pastry" whose method bakes a semolina batter into a cake and layers it with whipped cream and mango → ["Desserts & Sweets", "Baked", "Vegetarian"]. It is NOT "Beverages & Drinks".

ALLOWED CATEGORIES (group: options):
${list}

First reason briefly, then output JSON: { "reasoning": "<1-2 short sentences>", "categories": ["Exact Category Name"] }`

  const user = hasText
    ? `Recipe name: "${recipeName}"\n\n${recipeText}`
    : `Recipe name: "${recipeName}" (no recipe text available)`

  const data = await aiChat({
    model: AI_MODELS.smart,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  })
  const parsed = JSON.parse(data.choices[0].message.content.trim())
  const allowed = new Map(taxonomy.flatMap(g => g.items).map(n => [n.toLowerCase(), n]))
  const out: string[] = []
  const seen = new Set<string>()
  if (Array.isArray(parsed.categories)) {
    for (const c of parsed.categories) {
      const canon = allowed.get(String(c).trim().toLowerCase())
      if (canon && !seen.has(canon)) { seen.add(canon); out.push(canon) }
    }
  }
  return out
}

const FORMAT_BASE = `You are a recipe editor. Given raw recipe text, return JSON.

1. FORMAT the recipe into clean markdown:
**Ingredients:**
- ingredient with quantity

**Method:**
1. Step one
2. Step two

2. EXTRACT 3-6 key ingredient tags — main ingredients only (e.g. paneer, chicken, rice, maida, coconut). Skip spices (cumin, turmeric, salt, pepper, chilli, garam masala, etc.) and oils/water/sugar.`

const FORMAT_RULES = `Rules for formatting:
- Use **Ingredients:** and **Method:** as bold headings with a colon
- Every ingredient as a bullet (-)
- Every method step numbered (1. 2. 3.)
- Fix grammar and spelling
- Keep all original content — do not add or remove steps`

// Build the system prompt, optionally adding conservative category classification.
function buildPrompt(taxonomy?: CategoryTaxonomy): string {
  if (!taxonomy || taxonomy.length === 0) {
    return `${FORMAT_BASE}

Return ONLY this JSON (no other text):
{ "recipe": "<formatted markdown>", "tags": ["ingredient1", "ingredient2"] }

${FORMAT_RULES}`
  }
  const list = taxonomy.map(g => `${g.group}: ${g.items.join(', ')}`).join('\n')
  return `${FORMAT_BASE}

3. CATEGORIZE: choose the categories that CLEARLY apply, ONLY from the allowed list below.
${CATEGORY_RULES}

ALLOWED CATEGORIES (group: options):
${list}

Return ONLY this JSON (no other text):
{ "recipe": "<formatted markdown>", "tags": ["ingredient1", "ingredient2"], "categories": ["Exact Category Name"] }

${FORMAT_RULES}`
}

// Format raw recipe text into markdown + extract tags (+ optionally categorize).
// Pass the taxonomy to enable conservative auto-categorization.
export async function formatRecipeWithAI(
  rawText: string, recipeName: string, taxonomy?: CategoryTaxonomy
): Promise<AiFormatResult> {
  const data = await aiChat({
    model: AI_MODELS.smart,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildPrompt(taxonomy) },
      { role: 'user', content: `Recipe name: "${recipeName}"\n\n${rawText}` },
    ],
  })
  const parsed = JSON.parse(data.choices[0].message.content.trim())

  // Validate categories against the allowed list (case-insensitive → canonical).
  let categories: string[] = []
  if (taxonomy && Array.isArray(parsed.categories)) {
    const allowed = new Map(taxonomy.flatMap(g => g.items).map(n => [n.toLowerCase(), n]))
    const seen = new Set<string>()
    for (const c of parsed.categories) {
      const canon = allowed.get(String(c).trim().toLowerCase())
      if (canon && !seen.has(canon)) { seen.add(canon); categories.push(canon) }
    }
  }

  return {
    recipe: (parsed.recipe || '').trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean)
      : [],
    categories,
  }
}

// Write formatted text + merge tags onto a recipe, creating any new tag records.
// Pass `knownTags` to avoid redundant tag lookups during a batch.
export async function attachToRecipe(
  recipeId: string, formatted: string, aiTags: string[], knownTags?: Set<string>, aiCategories?: string[]
): Promise<void> {
  const current = await pb.collection('recipes').getOne(recipeId, { fields: 'tags,categories' })
  const existing = Array.isArray(current.tags) ? current.tags as string[] : []
  const existingLower = new Set(existing.map(t => t.toLowerCase()))
  const newTags = normalizeTagList(aiTags).filter(t => !existingLower.has(t.toLowerCase()))

  for (const tag of newTags) {
    if (knownTags && knownTags.has(tag.toLowerCase())) continue
    await pb.collection('tags').create({ name: tag }).catch(() => {})
    knownTags?.add(tag.toLowerCase())
  }

  const payload: Record<string, unknown> = {
    recipe_copy: formatted,
    tags: [...existing, ...newTags],
  }
  // Merge any auto-assigned categories without clobbering existing ones.
  if (aiCategories && aiCategories.length) {
    const existingCats = Array.isArray(current.categories) ? current.categories as string[] : []
    const catLower = new Set(existingCats.map(c => c.toLowerCase()))
    payload.categories = [...existingCats, ...aiCategories.filter(c => !catLower.has(c.toLowerCase()))]
  }
  await pb.collection('recipes').update(recipeId, payload)
}

// True if the recipe already has non-empty recipe_copy (i.e. importing would overwrite).
export async function recipeHasText(recipeId: string): Promise<boolean> {
  try {
    const r = await pb.collection('recipes').getOne(recipeId, { fields: 'recipe_copy' })
    return !!(r.recipe_copy && String(r.recipe_copy).trim())
  } catch {
    return false
  }
}

// ─── Filename → recipe matching ────────────────────────────────────────────────
// We rank a filename against the whole recipe list client-side using significant-
// token overlap, which is far more precise than a substring search. Noise words
// (numbers, time/filler words like "minute", "easy", "recipe") are stripped so a
// file like "1 minute cold coffee" can never match "5 Minutes Rasmalai Cake".

const MATCH_STOPWORDS = new Set([
  'recipe', 'recipes', 'easy', 'quick', 'simple', 'homemade', 'style', 'best',
  'perfect', 'the', 'a', 'an', 'with', 'and', 'of', 'for', 'in', 'to', 'on',
  'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'sec', 'secs', 'second',
  'seconds', 'instant', 'no', 'how', 'make', 'making', 'at', 'home', 'ingredient',
  'ingredients', 'special', 'tasty', 'yummy', 'delicious', 'super', 'new', 'my',
])

// Significant lowercase tokens for a recipe / file name (numbers and noise removed).
export function recipeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\.docx$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !/^\d+$/.test(t))         // drop pure numbers
    .filter(t => !MATCH_STOPWORDS.has(t))  // drop filler words
}

// Levenshtein edit distance, bounded by `max` (returns max+1 once exceeded so we
// can bail early). Cheap because callers pre-gate on length and first character.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > max) return max + 1   // whole row already over budget → bail
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

// Typo-tolerant token equality. Exact tokens always match; otherwise we allow a
// small edit distance, but only for longer tokens that share a first letter, so
// short words ("dal"/"dahi", "rice"/"nice") still require an exact match.
function fuzzyEq(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  if (a[0] !== b[0]) return false
  const max = Math.max(a.length, b.length) >= 8 ? 2 : 1
  return editDistance(a, b, max) <= max
}

// Count fuzzy-matched tokens between two sets with greedy one-to-one pairing, so
// a single token can't be credited against several near-spellings.
function fuzzyIntersection(a: string[], b: string[]): number {
  const used = new Array(b.length).fill(false)
  let inter = 0
  for (const t of a) {
    for (let j = 0; j < b.length; j++) {
      if (!used[j] && fuzzyEq(t, b[j])) { used[j] = true; inter++; break }
    }
  }
  return inter
}

// Sørensen–Dice overlap of two token sets → 1.0 when the sets are identical.
// Tokens that differ only by a small typo still count toward the overlap.
function diceScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = [...new Set(a)], sb = [...new Set(b)]
  const inter = fuzzyIntersection(sa, sb)
  return (2 * inter) / (sa.length + sb.length)
}

export interface RecipeIndexEntry {
  id: string
  sl_no: number
  recipe_name: string
  has_text: boolean
  tokens: string[]
}

// Load every recipe once (id, sl_no, name, whether it already has text). Uses an
// excerpt(1) on recipe_copy so we never pull full bodies just to test emptiness.
export async function loadRecipeIndex(): Promise<RecipeIndexEntry[]> {
  const recs = await pb.collection('recipes').getFullList({
    fields: 'id,sl_no,recipe_name,recipe_copy:excerpt(1)',
    sort: 'sl_no',
    batch: 500,
  })
  return recs.map(r => ({
    id: r.id as string,
    sl_no: r.sl_no as number,
    recipe_name: r.recipe_name as string,
    has_text: !!(r['recipe_copy'] && String(r['recipe_copy']).trim()),
    tokens: recipeTokens(r.recipe_name as string),
  }))
}

export interface MatchResult {
  candidates: Candidate[]    // best-first, score >= MIN_MATCH_SCORE, capped
  best: Candidate | null     // the top candidate (or null when none)
  bestScore: number          // similarity of the top candidate (0–1)
  confident: boolean         // safe to auto-import to `best` without review
  alreadyImported: boolean   // a recipe with text matches strongly → skip the doc
}

const MIN_MATCH_SCORE = 0.34   // below this a recipe is not even shown as a candidate
const AUTO_MATCH_SCORE = 0.72  // best must reach this to auto-import
const AUTO_MATCH_MARGIN = 0.25 // …and lead the runner-up by this much (so duplicates stay ambiguous)
const MAX_CANDIDATES = 6

// Fraction of `a`'s distinct tokens that also appear in `b` (directional
// coverage). Typo-tolerant: a token counts as present on a small-edit match.
function coverage(a: string[], b: string[]): number {
  const sa = [...new Set(a)]
  if (!sa.length) return 0
  const sb = [...new Set(b)]
  let hit = 0
  for (const t of sa) if (sb.some(x => fuzzyEq(t, x))) hit++
  return hit / sa.length
}

// Rank a filename against the recipe index. Returns the plausible candidates
// (best first) and whether the top one is a confident, unambiguous match.
export function matchFilename(filename: string, index: RecipeIndexEntry[]): MatchResult {
  const fileTok = recipeTokens(filename)
  const scored = index
    .map(r => ({ entry: r, score: diceScore(fileTok, r.tokens) }))
    .filter(s => s.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)

  // Recipes that already have real text are done — never offer them as
  // suggestions. `best` still tracks the true top match (text or not) so an
  // already-imported doc is detected and silently skipped, not re-queued.
  const candidates = scored
    .filter(s => !s.entry.has_text)
    .slice(0, MAX_CANDIDATES)
    .map(s => ({
      id: s.entry.id, sl_no: s.entry.sl_no, recipe_name: s.entry.recipe_name, has_text: s.entry.has_text,
    }))
  const bestEntry = scored[0]
  const best = bestEntry
    ? { id: bestEntry.entry.id, sl_no: bestEntry.entry.sl_no, recipe_name: bestEntry.entry.recipe_name, has_text: bestEntry.entry.has_text }
    : null
  const bestScore = bestEntry?.score ?? 0
  const secondScore = scored[1]?.score ?? 0
  const margin = bestScore - secondScore

  // A filename is a confident match when one recipe clearly stands out:
  //  • high overlap AND a clear lead over the runner-up, OR
  //  • an exact token-set match that's essentially unique, OR
  //  • every significant filename token is contained in the recipe name
  //    (e.g. "Mango Pastry" → "Mango Pastry Cake") with a clear lead.
  const exact = !!bestEntry && bestScore >= 0.999
  const contained =
    !!bestEntry && fileTok.length >= 2 && coverage(fileTok, bestEntry.entry.tokens) === 1
  const confident = !!best && (
    (bestScore >= AUTO_MATCH_SCORE && margin >= AUTO_MATCH_MARGIN) ||
    (exact && margin >= 0.1) ||
    (contained && bestScore >= 0.6 && margin >= 0.12)
  )

  // The doc is "already imported" when a recipe that already has text matches
  // strongly — re-importing it would duplicate or overwrite existing content, so
  // skip it. Catches the case where an empty recipe edges out the real (filled)
  // target on score: scored is sorted, so the first has_text entry is its best.
  const topTextScore = scored.find(s => s.entry.has_text)?.score ?? 0
  const alreadyImported = (!!bestEntry && bestEntry.entry.has_text) || topTextScore >= AUTO_MATCH_SCORE

  return { candidates, best, bestScore, confident, alreadyImported }
}

// ─── Content-based duplicate detection ────────────────────────────────────────
// Filename matching misses an already-imported recipe when the file name and the
// recipe name diverge (e.g. regional spellings "Parwal" vs "Patal"). As a safety
// net, compare the doc's distinctive body words against existing recipe bodies:
// if most of them already appear in one recipe, the doc is already imported.

const DUP_MIN_TOKENS = 8       // need enough distinctive words to trust a match
const DUP_COVERAGE = 0.55      // ≥55% of the doc's words present in a body → dup
const DUP_SEARCH_TERMS = 4     // distinctive words used to find candidate recipes
const DUP_MAX_CANDIDATES = 24

// Distinctive (≥4-char, non-noise) words of a block of text, deduped.
function contentTokens(text: string): string[] {
  return [...new Set(recipeTokens(text).filter(t => t.length >= 4))]
}

// Returns the recipe whose body already contains this doc's content, or null.
// Only meant for docs with no confident filename match (a fallback, so the cost
// of a few searches is paid only when something would otherwise go to review).
export async function findImportedDuplicate(
  rawText: string,
): Promise<{ id: string; sl_no: number; recipe_name: string } | null> {
  const docTokens = contentTokens(rawText)
  if (docTokens.length < DUP_MIN_TOKENS) return null

  // Find candidate recipes by their most distinctive (longest) words. A union
  // across a few terms keeps recall up without scanning every recipe body.
  const terms = [...docTokens].sort((a, b) => b.length - a.length).slice(0, DUP_SEARCH_TERMS)
  const seen = new Map<string, { id: string; sl_no: number; recipe_name: string; body: string }>()
  for (const term of terms) {
    if (seen.size >= DUP_MAX_CANDIDATES) break
    try {
      const res = await pb.collection('recipes').getList(1, 10, {
        filter: pb.filter('recipe_copy ~ {:q}', { q: term }),
        fields: 'id,sl_no,recipe_name,recipe_copy',
      })
      for (const r of res.items) {
        if (!seen.has(r.id)) {
          seen.set(r.id, {
            id: r.id, sl_no: r.sl_no as number, recipe_name: r.recipe_name as string,
            body: String(r.recipe_copy || ''),
          })
        }
      }
    } catch { /* skip a failed term, keep going */ }
  }
  if (!seen.size) return null

  // Pick the recipe whose body covers the most of the doc's distinctive words.
  let best: { id: string; sl_no: number; recipe_name: string } | null = null
  let bestCov = 0
  for (const c of seen.values()) {
    const bodySet = new Set(contentTokens(c.body))
    let hit = 0
    for (const t of docTokens) if (bodySet.has(t)) hit++
    const cov = hit / docTokens.length
    if (cov > bestCov) { bestCov = cov; best = { id: c.id, sl_no: c.sl_no, recipe_name: c.recipe_name } }
  }
  return bestCov >= DUP_COVERAGE ? best : null
}

// ─── Review queue persistence ─────────────────────────────────────────────────

export type ReviewReason = 'no_match' | 'multiple_matches' | 'error' | 'duplicate'

export interface ReviewItemInput {
  file_name: string
  raw_text: string
  reason: ReviewReason
  duplicate: boolean
  candidates: Candidate[]
  note?: string
}

// Save a skipped import to the review queue. Upserts on the pending row for the
// same file name so re-running an import doesn't pile up duplicate rows.
export async function saveReviewItem(item: ReviewItemInput): Promise<void> {
  const payload = { ...item, candidates: item.candidates, status: 'pending' }
  try {
    const existing = await pb.collection('review_queue').getFirstListItem(
      pb.filter('file_name = {:f} && status = "pending"', { f: item.file_name })
    )
    await pb.collection('review_queue').update(existing.id, payload)
  } catch {
    await pb.collection('review_queue').create(payload)
  }
}
