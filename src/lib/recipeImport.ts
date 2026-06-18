import { pb } from './pocketbase'
import { aiChat } from './ai'

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
}

const FORMAT_SYSTEM_PROMPT = `You are a recipe editor. Given raw recipe text, do two things and return JSON.

1. FORMAT the recipe into clean markdown:
**Ingredients:**
- ingredient with quantity

**Method:**
1. Step one
2. Step two

2. EXTRACT 3-6 key ingredient tags — main ingredients only (e.g. paneer, chicken, rice, maida, coconut). Skip spices (cumin, turmeric, salt, pepper, chilli, garam masala, etc.) and oils/water/sugar.

Return ONLY this JSON (no other text):
{
  "recipe": "<formatted markdown here>",
  "tags": ["ingredient1", "ingredient2", "ingredient3"]
}

Rules for formatting:
- Use **Ingredients:** and **Method:** as bold headings with a colon
- Every ingredient as a bullet (-)
- Every method step numbered (1. 2. 3.)
- Fix grammar and spelling
- Keep all original content — do not add or remove steps`

// Format raw recipe text into markdown + extract ingredient tags via the AI proxy.
export async function formatRecipeWithAI(
  rawText: string, recipeName: string
): Promise<AiFormatResult> {
  const data = await aiChat({
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: FORMAT_SYSTEM_PROMPT },
      { role: 'user', content: `Recipe name: "${recipeName}"\n\n${rawText}` },
    ],
  })
  const parsed = JSON.parse(data.choices[0].message.content.trim())
  return {
    recipe: (parsed.recipe || '').trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean)
      : [],
  }
}

// Write formatted text + merge tags onto a recipe, creating any new tag records.
// Pass `knownTags` to avoid redundant tag lookups during a batch.
export async function attachToRecipe(
  recipeId: string, formatted: string, aiTags: string[], knownTags?: Set<string>
): Promise<void> {
  const current = await pb.collection('recipes').getOne(recipeId, { fields: 'tags' })
  const existing = Array.isArray(current.tags) ? current.tags as string[] : []
  const existingLower = new Set(existing.map(t => t.toLowerCase()))
  const newTags = aiTags.filter(t => !existingLower.has(t.toLowerCase()))

  for (const tag of newTags) {
    if (knownTags && knownTags.has(tag.toLowerCase())) continue
    await pb.collection('tags').create({ name: tag }).catch(() => {})
    knownTags?.add(tag.toLowerCase())
  }

  await pb.collection('recipes').update(recipeId, {
    recipe_copy: formatted,
    tags: [...existing, ...newTags],
  })
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
