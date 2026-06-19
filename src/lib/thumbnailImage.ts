import { aiChat } from './ai'

// 9:16 thumbnail composition + AI "best photo" selection.

export const THUMB_W = 1080
export const THUMB_H = 1920
export const DEFAULT_COLOR_1 = '#F1591F' // orange
export const DEFAULT_COLOR_2 = '#1E6E8C' // teal

// Ask AI vision to choose the most thumbnail-worthy photo. Returns a 0-based index.
export async function pickBestImage(recipeName: string, dataUrls: string[]): Promise<number> {
  if (dataUrls.length <= 1) return 0
  try {
    const data = await aiChat({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a food photo editor choosing the single most appetizing, sharp, well-composed photo to use as a vertical 9:16 social thumbnail. Prefer bright, clear, close-up hero shots of the finished dish. Reply ONLY with JSON {"index": <0-based number>}.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Recipe: ${recipeName}. Choose the best of these ${dataUrls.length} photos (0-indexed).` },
            ...dataUrls.map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } })),
          ],
        },
      ],
    })
    const parsed = JSON.parse(data.choices[0].message.content.trim())
    const idx = Number(parsed.index)
    return Number.isInteger(idx) && idx >= 0 && idx < dataUrls.length ? idx : 0
  } catch {
    return 0 // fall back to the first image on any failure
  }
}

// ── canvas composition ────────────────────────────────────────────────────────
let fontsReady = false
async function ensureFonts(): Promise<void> {
  if (fontsReady) return
  try {
    await Promise.all([
      document.fonts.load('400 100px MintsBrushBold'),
      document.fonts.load('400 100px MintsBrushScript'),
    ])
    await document.fonts.ready
  } catch { /* fall back to system fonts */ }
  fontsReady = true
}

function fitFontSize(
  ctx: CanvasRenderingContext2D, text: string, family: string, maxWidth: number, startPx: number,
): number {
  let size = startPx
  ctx.font = `400 ${size}px ${family}`
  while (size > 28 && ctx.measureText(text).width > maxWidth) {
    size -= 4
    ctx.font = `400 ${size}px ${family}`
  }
  return size
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface ThumbnailOptions {
  file: File
  line1: string
  line2: string
  color1: string
  color2: string
  size1?: number // desired/max px for line 1 (auto-shrinks only if it overflows width)
  size2?: number // desired/max px for line 2
  bannerWidth?: number // cream banner width in px (centred horizontally)
  paddingY?: number // cream border above/below the text (px)
  lineGap?: number // vertical space between line 1 and line 2 (px; can be negative to tighten)
}

export const DEFAULT_FONT_SIZE_1 = 198
export const DEFAULT_FONT_SIZE_2 = 204
export const MIN_FONT_SIZE = 40
export const MAX_FONT_SIZE = 240

export const DEFAULT_BANNER_WIDTH = THUMB_W - 96 // 984 — matches the original full-width banner
export const MIN_BANNER_WIDTH = 480
export const MAX_BANNER_WIDTH = THUMB_W - 16 // 1064

export const DEFAULT_PADDING_Y = 8
export const MIN_PADDING_Y = 8
export const MAX_PADDING_Y = 140

export const DEFAULT_LINE_GAP = -70
export const MIN_LINE_GAP = -80
export const MAX_LINE_GAP = 160

// Compose a 1080x1920 thumbnail: cover-fit photo + cream banner + two-tone title.
export async function composeThumbnail(opts: ThumbnailOptions): Promise<Blob> {
  await ensureFonts()
  const bitmap = await createImageBitmap(opts.file)

  const canvas = document.createElement('canvas')
  canvas.width = THUMB_W
  canvas.height = THUMB_H
  const ctx = canvas.getContext('2d')!

  // cover-fit the photo
  const scale = Math.max(THUMB_W / bitmap.width, THUMB_H / bitmap.height)
  const dw = bitmap.width * scale
  const dh = bitmap.height * scale
  ctx.drawImage(bitmap, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh)
  bitmap.close()

  const line1 = (opts.line1 || '').trim().toUpperCase()
  const line2 = (opts.line2 || '').trim()

  if (line1 || line2) {
    const margin = 48
    const bw = opts.bannerWidth ?? DEFAULT_BANNER_WIDTH
    const bx = (THUMB_W - bw) / 2 // centred horizontally
    const by = margin
    const maxTextW = bw - 80
    const padY = opts.paddingY ?? DEFAULT_PADDING_Y
    const lineGap = line1 && line2 ? (opts.lineGap ?? DEFAULT_LINE_GAP) : 0

    const s1 = line1 ? fitFontSize(ctx, line1, 'MintsBrushBold', maxTextW, opts.size1 ?? DEFAULT_FONT_SIZE_1) : 0
    const s2 = line2 ? fitFontSize(ctx, line2, 'MintsBrushScript', maxTextW, opts.size2 ?? DEFAULT_FONT_SIZE_2) : 0

    // Box hugs the text: height = top/bottom padding + both lines + the gap between them.
    const bh = padY * 2 + s1 + s2 + lineGap

    // cream banner with soft shadow
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur = 30
    ctx.shadowOffsetY = 10
    roundRect(ctx, bx, by, bw, bh, 36)
    ctx.fillStyle = '#FBF7E9'
    ctx.fill()
    ctx.restore()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const cx = THUMB_W / 2
    let cy = by + padY

    if (line1) {
      cy += s1 * 0.78
      ctx.font = `400 ${s1}px MintsBrushBold`
      ctx.fillStyle = opts.color1
      ctx.fillText(line1, cx, cy)
      cy += s1 * 0.22 + lineGap
    }
    if (line2) {
      cy += s2 * 0.78
      ctx.font = `400 ${s2}px MintsBrushScript`
      ctx.fillStyle = opts.color2
      ctx.fillText(line2, cx, cy)
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Failed to render image'))), 'image/png')
  })
}

// Split a recipe name into two title lines (first half / second half of words).
export function defaultTitleLines(name: string): { line1: string; line2: string } {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return { line1: name.trim(), line2: '' }
  const half = Math.ceil(words.length / 2)
  return { line1: words.slice(0, half).join(' '), line2: words.slice(half).join(' ') }
}
