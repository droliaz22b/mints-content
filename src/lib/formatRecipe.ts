import { aiChat, AI_MODELS } from './ai'

/**
 * Converts legacy plain-text recipe format (using • as bullet separator) to markdown.
 * Passes through text that already contains markdown syntax unchanged.
 */
export function preprocessToMarkdown(raw: string): string {
  if (!raw?.trim()) return raw

  // Already has markdown formatting → render as-is
  if (/\*\*/.test(raw) || /^- /m.test(raw) || /^\d+\. /m.test(raw)) return raw

  // Multi-line text without • → bold any ALL-CAPS section header lines and return
  if (raw.includes('\n')) {
    return raw
      .replace(/^(INGREDIENTS?|METHOD|HOW TO(?: MAKE)?|INSTRUCTIONS?)[:\s]*$/gim, '\n**$1:**\n')
      .trim()
  }

  // Single-line bullet format using • character
  if (!raw.includes('•')) return raw

  const parts = raw.split(/\s*•\s*/).map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return raw

  const out: string[] = []

  // Detect a section header at the END of a part.
  // Not using /i flag intentionally: "for frying" (lowercase) should NOT match,
  // but "For Marination" (capital F) should.
  const SECTION_AT_END = /^(.*)\s+(For(?:\s+(?:the|The)\s+)?\w[\w\s]*|Other\s+\w[\w\s]*|Method|Instructions?|How\s+to(?:\s+Make)?)$/

  parts.forEach((part, i) => {
    if (i === 0) {
      // First chunk often has "[Recipe Title] INGREDIENTS [Sub-section name]"
      const m = part.match(/^(.+?)\s+INGREDIENTS\s*(.*)$/i)
      if (m) {
        const title = m[1].trim()
        const sub = m[2].trim()
        if (title) out.push(`**${title}**\n`)
        out.push('**Ingredients:**')
        if (sub) out.push(`\n**${sub}:**`)
      } else {
        out.push(part)
      }
    } else {
      // Check if this item ends with a section header
      const m = part.match(SECTION_AT_END)
      if (m) {
        const ingredient = m[1].trim()
        const section = m[2].trim()
        if (ingredient) out.push(`- ${ingredient}`)
        out.push(`\n**${section}:**`)
      } else {
        out.push(`- ${part}`)
      }
    }
  })

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** System prompt used for AI formatting of recipe text */
export const FORMAT_SYSTEM_PROMPT = `You are a recipe editor. Format and fix the grammar of recipe text.

Output using this exact structure:

**Ingredients:**
- ingredient with quantity
- ingredient with quantity

**Method:**
1. Clear step
2. Clear step

Rules:
- Use **Ingredients:** and **Method:** as bold headings with a colon
- List every ingredient as a bullet point starting with -
- Number every method step (1. 2. 3.)
- Fix all grammar and spelling errors
- Keep all original content — do not add or remove ingredients or steps
- Clean up spacing and punctuation
- Use only markdown formatting (**, -, 1.) — no HTML`

// ─── Short recipe rewrite (for quick sharing / DMs) ───────────────────────────
// Hard cap on the compact rewrite. The prompt asks for this, but models are
// unreliable about character counts, so we also enforce it with a retry below.
export const SHORT_RECIPE_CHAR_LIMIT = 900

export const SHORT_RECIPE_SYSTEM_PROMPT = `You are a recipe editor. Rewrite the given recipe as a compact version that fits within ${SHORT_RECIPE_CHAR_LIMIT} characters total.

Output using this exact structure (plain text, no markdown):

Recipe Name

Ingredients:
- ingredient with quantity
- ingredient with quantity

Method:
1. Clear concise step
2. Clear concise step

Rules:
- Start with the recipe name on its own line, followed by a blank line.
- The ENTIRE output MUST be under ${SHORT_RECIPE_CHAR_LIMIT} characters.
- Keep every ingredient, but trim the wording.
- Number every method step (1. 2. 3.) and keep each step short and actionable.
- Combine or condense steps where possible without losing meaning.
- Plain text only — no bold, no asterisks, no markdown headings.
- Output only the recipe text — no preamble, labels, or explanation.`

// Rewrite a recipe into a compact, numbered version under SHORT_RECIPE_CHAR_LIMIT
// characters, via the shared AI proxy. Retries once if the model runs over.
export async function rewriteRecipeShort(recipeName: string, recipeText: string): Promise<string> {
  const userMsg = `Recipe Name: ${recipeName}\n\n${recipeText}`

  const data = await aiChat({
    model: AI_MODELS.smart,
    temperature: 0.4,
    messages: [
      { role: 'system', content: SHORT_RECIPE_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  })
  let out = data.choices[0].message.content.trim()

  if (out.length > SHORT_RECIPE_CHAR_LIMIT) {
    const retry = await aiChat({
      model: AI_MODELS.smart,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SHORT_RECIPE_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
        { role: 'assistant', content: out },
        {
          role: 'user',
          content:
            `That is ${out.length} characters — too long. Rewrite it to UNDER ` +
            `${SHORT_RECIPE_CHAR_LIMIT} characters. Keep the recipe name on top, all ingredients ` +
            `and the numbered steps, but tighten the wording. Output only the recipe text.`,
        },
      ],
    })
    out = retry.choices[0].message.content.trim()
  }

  return out
}
