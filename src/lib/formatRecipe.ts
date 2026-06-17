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
