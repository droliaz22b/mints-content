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
}

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
    const bx = margin
    const bw = THUMB_W - margin * 2
    const by = margin
    const maxTextW = bw - 80
    const padY = 44
    const gap = line1 && line2 ? 8 : 0

    const s1 = line1 ? fitFontSize(ctx, line1, 'MintsBrushBold', maxTextW, 150) : 0
    const s2 = line2 ? fitFontSize(ctx, line2, 'MintsBrushScript', maxTextW, 150) : 0
    const bh = padY * 2 + s1 + s2 + gap

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
      cy += s1 * 0.8
      ctx.font = `400 ${s1}px MintsBrushBold`
      ctx.fillStyle = opts.color1
      ctx.fillText(line1, cx, cy)
      cy += s1 * 0.2 + gap
    }
    if (line2) {
      cy += s2 * 0.8
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
