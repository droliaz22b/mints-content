import { pb } from './pocketbase'
import { aiChat } from './ai'
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
- Be conservative — it is far better to leave a category out than to guess. Do not "false flag".
- Use the EXACT category names from the list. Never invent new ones.
- Occasion/Festival and Season/Weather: include ONLY if the recipe is explicitly for that (e.g. mentions Navratri/fasting, Diwali, summer cooler). Otherwise leave them out.
- It is fine to return an empty list if nothing is clearly applicable.

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
