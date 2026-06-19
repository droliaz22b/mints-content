// Cross-tally the recipe database against the image sub-folders and flag
// mismatches (wrong numbers, misspelled names, ambiguous/duplicate matches,
// missing or orphan folders) so they can be rectified. Pure functions — the
// folder data is gathered by thumbnailFolder.listSubfolders().

import { matchComponents, type MatchComponents, type SubFolder } from './thumbnailFolder'

export interface AuditRecipe { id: string; sl_no: number; recipe_name: string }

export type AuditStatus =
  | 'ok' // name + number agree
  | 'name_mismatch' // matched by sl_no only — folder name differs (possible spelling issue)
  | 'number_mismatch' // matched by name only — folder missing/wrong sl_no
  | 'ambiguous' // a second folder matches almost as well
  | 'conflict' // the matched folder is also another recipe's best match
  | 'no_images' // matched folder has zero images
  | 'missing' // no folder matched well enough

export interface RecipeRow {
  recipe: AuditRecipe
  status: AuditStatus
  folderName: string | null
  imageCount: number
  match: MatchComponents | null
  runnerUp: { folderName: string; score: number } | null
  note: string
}

export interface OrphanFolder {
  name: string
  imageCount: number
  guessRecipe: AuditRecipe | null // closest recipe (below the accept threshold)
  guessScore: number
}

export type StatusCounts = Record<AuditStatus, number> & { total: number; orphans: number }

export interface AuditResult {
  rows: RecipeRow[]
  orphans: OrphanFolder[]
  counts: StatusCounts
}

const ACCEPT = 40 // same threshold the thumbnail picker uses to accept a folder
const AMBIGUOUS_MARGIN = 20 // best beats runner-up by less than this → ambiguous

interface Scored { folder: SubFolder; mc: MatchComponents }

// Parse a numeric sl_no range from a range-folder name, e.g. "401-600", "1 - 200".
// Returns null for non-numeric ranges like "A01 - A100" or "01 Thumbnails Mints Old".
export function parseRange(folderName: string): { min: number; max: number } | null {
  const m = folderName.match(/^\s*(\d{1,5})\s*[-–—]\s*(\d{1,5})\s*$/)
  if (!m) return null
  const a = Number(m[1]); const b = Number(m[2])
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

export interface ReconcileOptions {
  // When false, recipes with no matching folder are omitted (folder-centric audit
  // for non-numeric ranges where we can't tell which recipes belong).
  includeMissing?: boolean
}

export function reconcile(recipes: AuditRecipe[], folders: SubFolder[], opts: ReconcileOptions = {}): AuditResult {
  const includeMissing = opts.includeMissing ?? true
  // 1. best + runner-up folder for each recipe
  const ranked = recipes.map(recipe => {
    let best: Scored | null = null
    let second: Scored | null = null
    for (const folder of folders) {
      const mc = matchComponents(folder.name, recipe.sl_no, recipe.recipe_name)
      if (mc.score <= 0) continue
      if (!best || mc.score > best.mc.score) { second = best; best = { folder, mc } }
      else if (!second || mc.score > second.mc.score) { second = { folder, mc } }
    }
    return { recipe, best, second }
  })

  // 2. how many recipes claim each folder as their accepted best match
  const claims = new Map<string, number>()
  for (const r of ranked) {
    if (r.best && r.best.mc.score >= ACCEPT) {
      claims.set(r.best.folder.name, (claims.get(r.best.folder.name) ?? 0) + 1)
    }
  }

  // 3. classify each recipe
  const rows: RecipeRow[] = ranked.map(({ recipe, best, second }) => {
    if (!best || best.mc.score < ACCEPT) {
      return {
        recipe, status: 'missing', folderName: null, imageCount: 0,
        match: best?.mc ?? null, runnerUp: null,
        note: best ? `No confident match — closest: "${best.folder.name}"` : 'No matching folder found',
      }
    }

    const folderName = best.folder.name
    const imageCount = best.folder.imageCount
    const mc = best.mc
    const runnerUp = second && second.mc.score >= ACCEPT
      ? { folderName: second.folder.name, score: second.mc.score } : null
    const claimed = (claims.get(folderName) ?? 0) > 1
    const closeSecond = !!runnerUp && (mc.score - runnerUp.score) < AMBIGUOUS_MARGIN

    let status: AuditStatus
    let note: string
    if (claimed) {
      status = 'conflict'
      note = 'This folder is the best match for more than one recipe — likely a wrong number'
    } else if (closeSecond) {
      status = 'ambiguous'
      note = `Almost matches "${runnerUp!.folderName}" too — verify the right one`
    } else if (imageCount === 0) {
      status = 'no_images'
      note = 'Matched folder contains no images'
    } else if (mc.name !== 'none' && mc.number) {
      status = 'ok'
      note = mc.name === 'exact' ? 'Name + number match' : 'Name (partial) + number match'
    } else if (mc.name === 'none' && mc.number) {
      status = 'name_mismatch'
      note = 'Matched by sl_no only — folder name differs (possible spelling issue)'
    } else {
      status = 'number_mismatch'
      note = 'Matched by name only — sl_no not in folder name (possible wrong number)'
    }
    return { recipe, status, folderName, imageCount, match: mc, runnerUp, note }
  })

  // For non-numeric ranges we can't tell which recipes belong here, so don't
  // report every out-of-scope recipe as "missing" — keep only the matched ones.
  const reportedRows = includeMissing ? rows : rows.filter(r => r.status !== 'missing')

  // 4. orphan folders — not the accepted best of any recipe
  const used = new Set(rows.filter(r => r.folderName).map(r => r.folderName as string))
  const orphans: OrphanFolder[] = []
  for (const folder of folders) {
    if (used.has(folder.name)) continue
    let guess: AuditRecipe | null = null
    let guessScore = 0
    for (const recipe of recipes) {
      const mc = matchComponents(folder.name, recipe.sl_no, recipe.recipe_name)
      if (mc.score > guessScore) { guessScore = mc.score; guess = recipe }
    }
    orphans.push({ name: folder.name, imageCount: folder.imageCount, guessRecipe: guess, guessScore })
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  // 5. tallies
  const counts: StatusCounts = {
    ok: 0, name_mismatch: 0, number_mismatch: 0, ambiguous: 0, conflict: 0, no_images: 0, missing: 0,
    total: reportedRows.length, orphans: orphans.length,
  }
  for (const r of reportedRows) counts[r.status]++

  return { rows: reportedRows, orphans, counts }
}

// Canonical folder name we recommend ("45 - Paneer Tikka").
export function canonicalFolderName(slNo: number, recipeName: string): string {
  return `${slNo} - ${recipeName}`
}

export interface Recommendation {
  text: string // what to do
  copy?: string // a value worth copying (usually the correct folder name)
  recipeId?: string // if set, offer an "Open recipe" link
}

// Suggested fix for a recipe row.
export function recommendRow(row: RecipeRow): Recommendation {
  const { recipe, folderName } = row
  const canonical = canonicalFolderName(recipe.sl_no, recipe.recipe_name)
  switch (row.status) {
    case 'ok':
      return { text: 'No action needed' }
    case 'name_mismatch':
      return { text: `Rename folder “${folderName}” to match the recipe`, copy: canonical, recipeId: recipe.id }
    case 'number_mismatch':
      return { text: `Add the sl_no to folder “${folderName}”`, copy: canonical, recipeId: recipe.id }
    case 'missing':
      return { text: 'Create a folder for this recipe', copy: canonical, recipeId: recipe.id }
    case 'no_images':
      return { text: `Add photos to “${folderName}” (or check it isn’t nested too deep)` }
    case 'ambiguous':
      return { text: `Confirm “${folderName}” is right; rename the look-alike folder`, recipeId: recipe.id }
    case 'conflict':
      return { text: `Two recipes claim “${folderName}” — fix the wrong sl_no on one folder`, recipeId: recipe.id }
  }
}

// Suggested fix for an orphan folder.
export function recommendOrphan(o: OrphanFolder): Recommendation {
  if (o.guessRecipe) {
    return {
      text: `Looks like #${o.guessRecipe.sl_no} ${o.guessRecipe.recipe_name} — rename to match`,
      copy: canonicalFolderName(o.guessRecipe.sl_no, o.guessRecipe.recipe_name),
      recipeId: o.guessRecipe.id,
    }
  }
  return { text: 'No matching recipe — fix the sl_no/name or remove the folder' }
}

export const STATUS_LABELS: Record<AuditStatus, string> = {
  ok: 'OK',
  name_mismatch: 'Name mismatch',
  number_mismatch: 'Number mismatch',
  ambiguous: 'Ambiguous',
  conflict: 'Conflict',
  no_images: 'No images',
  missing: 'No folder',
}

// CSV of the full report (recipe rows + orphan folders).
export function auditToCsv(result: AuditResult): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const head = ['type', 'status', 'sl_no', 'recipe_name', 'matched_folder', 'images', 'note', 'recommended_action', 'suggested_name']
  const lines = [head.join(',')]
  for (const r of result.rows) {
    const rec = recommendRow(r)
    lines.push([
      esc('recipe'), esc(STATUS_LABELS[r.status]), esc(r.recipe.sl_no), esc(r.recipe.recipe_name),
      esc(r.folderName ?? ''), esc(r.imageCount), esc(r.note), esc(rec.text), esc(rec.copy ?? ''),
    ].join(','))
  }
  for (const o of result.orphans) {
    const rec = recommendOrphan(o)
    lines.push([
      esc('orphan_folder'), esc('Orphan folder'), esc(''), esc(''),
      esc(o.name), esc(o.imageCount),
      esc(o.guessRecipe ? `Closest recipe: #${o.guessRecipe.sl_no} ${o.guessRecipe.recipe_name}` : 'No close recipe'),
      esc(rec.text), esc(rec.copy ?? ''),
    ].join(','))
  }
  return lines.join('\n')
}
