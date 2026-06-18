import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, AlertCircle, FolderOpen, Sparkles, Download, RefreshCw, ImageIcon } from 'lucide-react'
import type { Recipe } from '../types'
import {
  supportsFolderPicker, pickRootFolder, getStoredRoot, clearRootFolder,
  findRecipeFolder, listImages, downscaleToDataUrl,
} from '../lib/thumbnailFolder'
import {
  pickBestImage, composeThumbnail, defaultTitleLines,
  DEFAULT_COLOR_1, DEFAULT_COLOR_2,
} from '../lib/thumbnailImage'

interface LoadedImage { name: string; file: File; dataUrl: string }

type Phase = 'init' | 'need-folder' | 'loading' | 'ready' | 'error'

export default function ThumbnailStudioModal({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('init')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [images, setImages] = useState<LoadedImage[]>([])
  const [selected, setSelected] = useState(0)
  const [aiPicking, setAiPicking] = useState(false)

  const init = defaultTitleLines(recipe.recipe_name)
  const [line1, setLine1] = useState(init.line1)
  const [line2, setLine2] = useState(init.line2)
  const [color1, setColor1] = useState(DEFAULT_COLOR_1)
  const [color2, setColor2] = useState(DEFAULT_COLOR_2)

  const [previewUrl, setPreviewUrl] = useState('')
  const [composing, setComposing] = useState(false)
  const blobRef = useRef<Blob | null>(null)

  // ── Load images from the matching sl_no folder ──────────────────────────────
  const loadFromRoot = useCallback(async (root: FileSystemDirectoryHandle) => {
    setPhase('loading'); setError(''); setStatus('Finding the photo folder…')
    const folder = await findRecipeFolder(root, recipe.sl_no, recipe.recipe_name)
    if (!folder) {
      setError(`No folder matching "${recipe.recipe_name}" or #${recipe.sl_no} was found in the selected root folder. The folder name should contain the recipe name or its number.`)
      setPhase('error'); return
    }
    let files
    try { files = await listImages(folder) } catch { setError('Could not read that folder.'); setPhase('error'); return }
    if (!files.length) { setError(`No images (.jpg/.png/.webp) found in folder "${recipe.sl_no}".`); setPhase('error'); return }

    setStatus(`Loading ${files.length} photo${files.length !== 1 ? 's' : ''} from OneDrive…`)
    const loaded: LoadedImage[] = []
    for (const f of files) {
      try { loaded.push({ ...f, dataUrl: await downscaleToDataUrl(f.file) }) }
      catch { /* online-only file couldn't hydrate — skip it */ }
    }
    if (!loaded.length) {
      setError("Couldn't read the images — make sure OneDrive is running and online, then try again.")
      setPhase('error'); return
    }
    setImages(loaded)
    setSelected(0)
    setPhase('ready')

    // AI auto-pick the best photo
    if (loaded.length > 1) {
      setAiPicking(true); setStatus('AI is choosing the best photo…')
      try {
        const idx = await pickBestImage(recipe.recipe_name, loaded.map(i => i.dataUrl))
        setSelected(idx)
      } catch { /* keep index 0 */ }
      setAiPicking(false); setStatus('')
    }
  }, [recipe.sl_no, recipe.recipe_name])

  // ── Initial run ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!supportsFolderPicker()) {
        setError('This feature needs Chrome or Edge (folder access).'); setPhase('error'); return
      }
      const root = await getStoredRoot()
      if (!root) { setPhase('need-folder'); return }
      await loadFromRoot(root)
    })()
  }, [loadFromRoot])

  async function chooseFolder() {
    try {
      const root = await pickRootFolder()
      await loadFromRoot(root)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { setError('Could not open the folder.'); setPhase('error') }
    }
  }

  async function changeFolder() {
    await clearRootFolder()
    setError('')
    setPhase('need-folder')
  }

  async function retry() {
    const root = await getStoredRoot()
    if (!root) { setError(''); setPhase('need-folder'); return }
    await loadFromRoot(root)
  }

  async function regenerateAiPick() {
    if (images.length < 2) return
    setAiPicking(true)
    try { setSelected(await pickBestImage(recipe.recipe_name, images.map(i => i.dataUrl))) }
    catch { /* ignore */ }
    setAiPicking(false)
  }

  // ── Compose preview whenever inputs change ──────────────────────────────────
  useEffect(() => {
    if (phase !== 'ready' || !images[selected]) return
    let cancelled = false
    const t = setTimeout(async () => {
      setComposing(true)
      try {
        const blob = await composeThumbnail({ file: images[selected].file, line1, line2, color1, color2 })
        if (cancelled) return
        blobRef.current = blob
        setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      } catch {
        if (!cancelled) setError('Could not render the thumbnail from this image.')
      } finally {
        if (!cancelled) setComposing(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [phase, images, selected, line1, line2, color1, color2])

  // cleanup object URL on unmount
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function download() {
    if (!blobRef.current) return
    const url = URL.createObjectURL(blobRef.current)
    const a = document.createElement('a')
    a.href = url
    a.download = `${recipe.recipe_name.replace(/[^\w\s-]/g, '').trim() || 'thumbnail'}-9x16.png`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold flex items-center gap-2"><ImageIcon size={17} className="text-amber-500" /> Make Thumbnail</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">#{recipe.sl_no} · {recipe.recipe_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex-shrink-0"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-5 mb-0 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          {phase === 'error' && supportsFolderPicker() && (
            <div className="px-5 py-5 flex flex-wrap gap-3">
              <button onClick={chooseFolder} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800">
                <FolderOpen size={15} /> Choose a different folder
              </button>
              <button onClick={retry} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                <RefreshCw size={15} /> Try again
              </button>
            </div>
          )}

          {phase === 'need-folder' && (
            <div className="p-8 text-center">
              <FolderOpen size={28} className="mx-auto mb-3 text-gray-400" />
              <p className="text-sm text-gray-600 mb-1">Choose your thumbnail photos folder.</p>
              <p className="text-xs text-gray-400 mb-4">Pick the parent folder that contains the numbered sub-folders (one per recipe sl_no). You only do this once.</p>
              <button onClick={chooseFolder} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800">
                <FolderOpen size={15} /> Select folder
              </button>
            </div>
          )}

          {(phase === 'init' || phase === 'loading') && (
            <div className="p-12 text-center text-gray-500">
              <Loader2 size={24} className="animate-spin mx-auto mb-3" />
              <p className="text-sm">{status || 'Loading…'}</p>
            </div>
          )}

          {phase === 'ready' && (
            <div className="grid sm:grid-cols-[300px_1fr] gap-0">
              {/* Left: controls */}
              <div className="p-5 space-y-4 border-r border-gray-100">
                {/* Title text */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Title — line 1</label>
                  <div className="flex gap-2">
                    <input value={line1} onChange={e => setLine1(e.target.value)} className="input flex-1" placeholder="Line 1" />
                    <input type="color" value={color1} onChange={e => setColor1(e.target.value)} className="w-9 h-9 rounded border border-gray-200 cursor-pointer flex-shrink-0" title="Line 1 colour" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Title — line 2</label>
                  <div className="flex gap-2">
                    <input value={line2} onChange={e => setLine2(e.target.value)} className="input flex-1" placeholder="Line 2" />
                    <input type="color" value={color2} onChange={e => setColor2(e.target.value)} className="w-9 h-9 rounded border border-gray-200 cursor-pointer flex-shrink-0" title="Line 2 colour" />
                  </div>
                </div>

                {/* Image grid */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Photo {aiPicking && <span className="text-amber-600 normal-case font-normal">· AI choosing…</span>}</label>
                    {images.length > 1 && (
                      <button onClick={regenerateAiPick} disabled={aiPicking} className="text-xs text-gray-500 hover:text-black flex items-center gap-1 disabled:opacity-50">
                        {aiPicking ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI pick
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
                    {images.map((img, i) => (
                      <button
                        key={img.name}
                        onClick={() => setSelected(i)}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 ${selected === i ? 'border-black' : 'border-transparent hover:border-gray-300'}`}
                        title={img.name}
                      >
                        <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={changeFolder} className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
                  <RefreshCw size={11} /> Change folder
                </button>
              </div>

              {/* Right: preview */}
              <div className="p-5 flex flex-col items-center bg-gray-50">
                <div className="relative w-[225px] h-[400px] rounded-xl overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
                  {previewUrl
                    ? <img src={previewUrl} alt="thumbnail preview" className="w-full h-full object-cover" />
                    : <Loader2 size={20} className="animate-spin text-gray-300" />}
                  {composing && previewUrl && (
                    <div className="absolute top-2 right-2 bg-white/80 rounded-full p-1"><Loader2 size={12} className="animate-spin text-gray-500" /></div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-2">1080 × 1920 (9:16)</p>
                <button
                  onClick={download}
                  disabled={!previewUrl || composing}
                  className="mt-4 flex items-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                >
                  <Download size={15} /> Download PNG
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
