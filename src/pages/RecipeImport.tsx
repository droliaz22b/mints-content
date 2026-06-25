import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { pb } from '../lib/pocketbase'
import { formatRecipeWithAI, saveReviewItem, loadCategoryTaxonomy, loadRecipeIndex, matchFilename } from '../lib/recipeImport'
import type { RecipeIndexEntry } from '../lib/recipeImport'
import { normalizeTagList } from '../lib/tagNormalize'
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  AlertCircle, ChevronDown, ChevronUp, X, ArrowLeft, FolderOpen, Zap, SkipForward, Search,
} from 'lucide-react'

interface Candidate { id: string; sl_no: number; recipe_name: string; has_text?: boolean }

type Phase = 'idle' | 'extracting' | 'matching' | 'ready' | 'uploading' | 'done' | 'skipped' | 'error'

interface FileEntry {
  uid: string
  file: File
  phase: Phase
  rawText?: string
  candidates?: Candidate[]
  selectedId?: string | null   // null = explicit skip
  formattedText?: string
  errorMsg?: string
  skipNote?: string             // why this file was auto-skipped to Review Later
  expanded: boolean
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer } as never)
  return result.value.trim()
}

// ─── main component ──────────────────────────────────────────────────────────

export default function RecipeImport() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [autoImporting, setAutoImporting] = useState(false)
  const [autoSummary, setAutoSummary] = useState<{ imported: number; review: number; duplicates: number; noMatch: number; errors: number } | null>(null)
  const [showProcessed, setShowProcessed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [folderLoading, setFolderLoading] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  function requestCancel() {
    cancelRef.current = true
    setCancelled(true)
  }

  async function selectFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (opts?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) { alert('Folder selection requires Chrome or Edge browser.'); return }
    setFolderLoading(true)
    try {
      const dir = await picker({ mode: 'read' })
      const files: File[] = []
      for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.docx')) {
          files.push(await (entry as FileSystemFileHandle).getFile())
        }
      }
      if (!files.length) { alert('No .docx files found in the selected folder.'); return }
      addFiles(files)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') alert('Could not read folder.')
    } finally {
      setFolderLoading(false)
    }
  }

  function patch(uid: string, delta: Partial<FileEntry>) {
    setEntries(prev => prev.map(e => e.uid === uid ? { ...e, ...delta } : e))
  }

  // Add a manually-searched recipe to a file's candidate list and select it,
  // so it can be picked & imported just like an auto-matched candidate.
  function addCandidate(uid: string, c: Candidate) {
    setEntries(prev => prev.map(e => {
      if (e.uid !== uid) return e
      const list = e.candidates ?? []
      const candidates = list.some(x => x.id === c.id) ? list : [...list, c]
      return { ...e, candidates, selectedId: c.id }
    }))
  }

  function addFiles(files: File[]) {
    const docx = files.filter(f => f.name.toLowerCase().endsWith('.docx'))
    if (!docx.length) return
    setEntries(prev => {
      const existing = new Set(prev.map(e => e.file.name))
      const fresh: FileEntry[] = docx
        .filter(f => !existing.has(f.name))
        .map(f => ({ uid: Math.random().toString(36).slice(2), file: f, phase: 'idle', expanded: false }))
      return [...prev, ...fresh]
    })
    setAutoSummary(null)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  // ── Shared tag helper ──────────────────────────────────────────────────────
  async function applyTagsAndUpload(
    recipeId: string, existingTags: string[], aiTags: string[],
    formatted: string, knownTags: Set<string>, aiCategories: string[] = []
  ) {
    const existingLower = new Set(existingTags.map((t: string) => t.toLowerCase()))
    const newTags = normalizeTagList(aiTags).filter(t => !existingLower.has(t.toLowerCase()))
    const mergedTags = [...existingTags, ...newTags]
    for (const tag of newTags) {
      if (!knownTags.has(tag.toLowerCase())) {
        await pb.collection('tags').create({ name: tag }).catch(() => {})
        knownTags.add(tag.toLowerCase())
      }
    }
    const payload: Record<string, unknown> = { recipe_copy: formatted, tags: mergedTags }
    if (aiCategories.length) payload.categories = aiCategories
    await pb.collection('recipes').update(recipeId, payload)
  }

  // ── Auto-Import All: uploads confident matches, queues the rest ───────────
  // - Confident match onto an empty recipe → imported immediately.
  // - Confident match onto a recipe that already has text → auto-skipped to
  //   Review Later (never overwritten silently).
  // - No plausible match → auto-skipped to Review Later.
  // - Multiple plausible candidates with no clear winner → kept inline for a
  //   quick pick (defaulting to Skip).
  async function autoImportAll() {
    const queue = entries.filter(e => e.phase === 'idle')
    if (!queue.length) return
    cancelRef.current = false
    setCancelled(false)
    setAutoImporting(true)
    setAutoSummary(null)

    const tagRecords = await pb.collection('tags').getFullList({ fields: 'name' }).catch(() => [])
    const knownTags = new Set(tagRecords.map((t) => (t['name'] as string || '').toLowerCase()))
    const taxonomy = await loadCategoryTaxonomy().catch(() => [])
    let index: RecipeIndexEntry[]
    try {
      index = await loadRecipeIndex()
    } catch {
      setAutoImporting(false)
      alert('Could not load the recipe list. Check your connection and try again.')
      return
    }

    let imported = 0, review = 0, duplicates = 0, noMatch = 0, errors = 0

    for (const entry of queue) {
      if (cancelRef.current) break
      patch(entry.uid, { phase: 'extracting' })
      let rawText: string
      try {
        rawText = await extractDocx(entry.file)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Could not read .docx file.' })
        await saveReviewItem({ file_name: entry.file.name, raw_text: '', reason: 'error', duplicate: false, candidates: [], note: 'Could not read .docx file.' }).catch(() => {})
        errors++; continue
      }

      patch(entry.uid, { phase: 'matching', rawText })
      const { candidates, best, confident } = matchFilename(entry.file.name, index)

      // Confident, unambiguous match onto an empty recipe → import right away.
      if (confident && best && !best.has_text) {
        patch(entry.uid, { phase: 'uploading', candidates, selectedId: best.id })
        try {
          const { recipe: formatted, tags: aiTags, categories: aiCats } = await formatRecipeWithAI(rawText, best.recipe_name, taxonomy)
          const current = await pb.collection('recipes').getOne(best.id, { fields: 'tags' }).catch(() => null)
          const existing = Array.isArray(current?.tags) ? current!.tags as string[] : []
          await applyTagsAndUpload(best.id, existing, aiTags, formatted, knownTags, aiCats)
          patch(entry.uid, { phase: 'done', formattedText: formatted })
          imported++
        } catch (err) {
          patch(entry.uid, { phase: 'error', errorMsg: err instanceof Error ? err.message : 'Upload failed' })
          await saveReviewItem({ file_name: entry.file.name, raw_text: rawText, reason: 'error', duplicate: false, candidates, note: err instanceof Error ? err.message : 'Upload failed' }).catch(() => {})
          errors++
        }
        continue
      }

      // Confident match but the recipe already has text → never overwrite; queue it.
      if (confident && best && best.has_text) {
        patch(entry.uid, { phase: 'skipped', rawText, candidates, selectedId: best.id, skipNote: `Matched #${best.sl_no} ${best.recipe_name}, which already has text` })
        await saveReviewItem({ file_name: entry.file.name, raw_text: rawText, reason: 'duplicate', duplicate: true, candidates }).catch(() => {})
        duplicates++; continue
      }

      // No plausible candidate at all → queue for later, no inline clutter.
      if (candidates.length === 0) {
        patch(entry.uid, { phase: 'skipped', rawText, candidates: [], selectedId: null, skipNote: 'No matching recipe found' })
        await saveReviewItem({ file_name: entry.file.name, raw_text: rawText, reason: 'no_match', duplicate: false, candidates: [] }).catch(() => {})
        noMatch++; continue
      }

      // Ambiguous — several plausible candidates, no clear winner. Keep inline so
      // the user can pick, but default to Skip so nothing is attached by accident.
      patch(entry.uid, { phase: 'ready', rawText, candidates, selectedId: null, expanded: true })
      await saveReviewItem({
        file_name: entry.file.name, raw_text: rawText,
        reason: 'multiple_matches', duplicate: candidates.some(c => c.has_text), candidates,
      }).catch(() => {})
      review++
    }

    setAutoSummary({ imported, review, duplicates, noMatch, errors })
    setAutoImporting(false)
  }

  // ── Match only (no upload) — review all before uploading ─────────────────
  // Pre-selects a confident match so clear files are one click away, but leaves
  // ambiguous / has-text files on Skip so nothing is attached by accident.
  const processAll = useCallback(async () => {
    const queue = entries.filter(e => e.phase === 'idle')
    if (!queue.length) return
    cancelRef.current = false
    setCancelled(false)
    setProcessing(true)

    let index: RecipeIndexEntry[]
    try {
      index = await loadRecipeIndex()
    } catch {
      setProcessing(false)
      alert('Could not load the recipe list. Check your connection and try again.')
      return
    }

    for (const entry of queue) {
      if (cancelRef.current) break
      patch(entry.uid, { phase: 'extracting' })
      let rawText: string
      try {
        rawText = await extractDocx(entry.file)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Could not read .docx file.' })
        continue
      }

      patch(entry.uid, { phase: 'matching', rawText })
      const { candidates, best, confident } = matchFilename(entry.file.name, index)
      // Default to Skip unless we have a confident match onto an empty recipe.
      const preselect = confident && best && !best.has_text ? best.id : null
      patch(entry.uid, {
        phase: 'ready',
        rawText,
        candidates,
        selectedId: preselect,
        expanded: !preselect,
      })
    }

    setProcessing(false)
  }, [entries])

  // ── Upload manually selected ready entries ────────────────────────────────
  async function uploadSelected() {
    const queue = entries.filter(e => e.phase === 'ready' && e.selectedId)
    if (!queue.length) return
    cancelRef.current = false
    setCancelled(false)
    setUploading(true)

    const tagRecords = await pb.collection('tags').getFullList({ fields: 'name' }).catch(() => [])
    const knownTags = new Set(tagRecords.map((t) => (t['name'] as string || '').toLowerCase()))
    const taxonomy = await loadCategoryTaxonomy().catch(() => [])

    for (const entry of queue) {
      if (cancelRef.current) break
      if (!entry.selectedId || !entry.rawText || !entry.candidates) continue
      const match = entry.candidates.find(c => c.id === entry.selectedId)
      if (!match) continue

      patch(entry.uid, { phase: 'uploading' })
      try {
        const { recipe: formatted, tags: aiTags, categories: aiCats } = await formatRecipeWithAI(entry.rawText, match.recipe_name, taxonomy)
        const current = await pb.collection('recipes').getOne(match.id, { fields: 'tags' })
        const existing = Array.isArray(current.tags) ? current.tags as string[] : []
        await applyTagsAndUpload(match.id, existing, aiTags, formatted, knownTags, aiCats)
        patch(entry.uid, { phase: 'done', formattedText: formatted })
      } catch (err) {
        patch(entry.uid, { phase: 'error', errorMsg: err instanceof Error ? err.message : 'Upload failed' })
      }
    }

    setUploading(false)
  }

  const busy = processing || uploading || autoImporting
  const idleCount   = entries.filter(e => e.phase === 'idle').length
  const readyCount  = entries.filter(e => e.phase === 'ready' && e.selectedId).length
  const doneCount   = entries.filter(e => e.phase === 'done').length
  const errorCount  = entries.filter(e => e.phase === 'error').length
  const reviewCount = entries.filter(e => e.phase === 'ready').length
  const skippedCount = entries.filter(e => e.phase === 'skipped').length
  const processedEntries = entries.filter(e => e.phase === 'done' || e.phase === 'skipped')

  return (
    <div className="w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Import from Docs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Add Word recipe files and attach them to your recipes automatically.</p>
        </div>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800" title="Back to Dashboard">
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* How it works */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2.5">How it works</p>
        <ol className="space-y-1.5 text-sm text-gray-600">
          <li className="flex gap-2.5"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-black text-white text-xs flex items-center justify-center font-medium">1</span> Add your <strong>.docx</strong> recipe files (or a whole folder).</li>
          <li className="flex gap-2.5"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-black text-white text-xs flex items-center justify-center font-medium">2</span> Click <strong>Start Import</strong> — files that clearly match one empty recipe are imported automatically.</li>
          <li className="flex gap-2.5"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-black text-white text-xs flex items-center justify-center font-medium">3</span> No match or already has text? It's sent to <strong>Review Later</strong>, never overwritten. Only genuinely ambiguous files stay below to <strong>pick or skip</strong>.</li>
        </ol>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors mb-4 ${
          dragging ? 'border-black bg-gray-50' : 'border-gray-200'
        }`}
      >
        <Upload size={22} className={`mx-auto mb-2 ${dragging ? 'text-black' : 'text-gray-400'}`} />
        <p className="text-sm font-medium text-gray-700 mb-3">Drop .docx files here</p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            <FileText size={14} /> Browse files
          </button>
          <button
            type="button"
            onClick={selectFolder}
            disabled={folderLoading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {folderLoading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            {folderLoading ? 'Reading folder…' : 'Select Folder'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Select a whole folder to load all .docx files at once</p>
        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          multiple
          className="hidden"
          onChange={e => e.target.files && addFiles(Array.from(e.target.files))}
        />
      </div>

      {/* Summary bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-500 mb-3 px-1">
          <span>{entries.length} file{entries.length !== 1 ? 's' : ''}</span>
          {doneCount  > 0 && <span className="text-green-600">✓ {doneCount} imported</span>}
          {reviewCount > 0 && <span className="text-amber-700">⚠ {reviewCount} need review</span>}
          {skippedCount > 0 && <span className="text-gray-500">↪ {skippedCount} to Review Later</span>}
          {errorCount > 0 && <span className="text-red-600">✕ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
          <button onClick={() => { setEntries([]); setAutoSummary(null) }} className="ml-auto text-gray-400 hover:text-gray-700 text-xs">
            Clear all
          </button>
        </div>
      )}

      {/* Auto-import result banner */}
      {autoSummary && !autoImporting && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 mb-4 space-y-1">
          {cancelled && (
            <p className="text-sm text-gray-700 flex items-center gap-2">
              <X size={14} /> Import cancelled. Remaining files are still queued below — click Start Import to continue.
            </p>
          )}
          {autoSummary.imported > 0 && (
            <p className="text-sm text-green-700 flex items-center gap-2">
              <CheckCircle size={14} />
              {autoSummary.imported} recipe{autoSummary.imported !== 1 ? 's' : ''} auto-imported successfully
            </p>
          )}
          {autoSummary.review > 0 && (
            <p className="text-sm text-amber-700 flex items-center gap-2">
              <AlertCircle size={14} />
              {autoSummary.review} ambiguous file{autoSummary.review !== 1 ? 's' : ''} need your pick — see below
            </p>
          )}
          {autoSummary.duplicates > 0 && (
            <p className="text-sm text-orange-700 flex items-center gap-2">
              <AlertCircle size={14} />
              {autoSummary.duplicates} matched recipe{autoSummary.duplicates !== 1 ? 's' : ''} already had text — not overwritten, sent to Review Later
            </p>
          )}
          {autoSummary.noMatch > 0 && (
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <AlertCircle size={14} />
              {autoSummary.noMatch} file{autoSummary.noMatch !== 1 ? 's' : ''} had no matching recipe — sent to Review Later
            </p>
          )}
          {autoSummary.errors > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-2">
              <XCircle size={14} />
              {autoSummary.errors} error{autoSummary.errors !== 1 ? 's' : ''}
            </p>
          )}
          {(autoSummary.duplicates + autoSummary.noMatch + autoSummary.errors) > 0 && (
            <p className="text-xs text-gray-500 pt-1">
              Skipped items are saved to the{' '}
              <button onClick={() => navigate('/review')} className="underline hover:text-black">Review Later</button>{' '}
              queue — you can resolve them anytime.
            </p>
          )}
        </div>
      )}

      {/* File cards — only files needing attention render in full. Imported and
          auto-skipped files collapse into a compact, expandable group below so a
          large batch stays light. Review-needed cards come first. */}
      {entries.length > 0 && (
        <div className="space-y-2 mb-5">
          {/* Files needing a pick at top */}
          {entries.filter(e => e.phase === 'ready').map(entry => (
            <EntryCard
              key={entry.uid}
              entry={entry}
              onRemove={() => setEntries(prev => prev.filter(e => e.uid !== entry.uid))}
              onSelect={id => patch(entry.uid, { selectedId: id })}
              onToggle={() => patch(entry.uid, { expanded: !entry.expanded })}
              onPickSearched={c => addCandidate(entry.uid, c)}
            />
          ))}
          {/* In-flight + errors (transient / need attention) */}
          {entries.filter(e => e.phase !== 'ready' && e.phase !== 'done' && e.phase !== 'skipped').map(entry => (
            <EntryCard
              key={entry.uid}
              entry={entry}
              onRemove={() => setEntries(prev => prev.filter(e => e.uid !== entry.uid))}
              onSelect={id => patch(entry.uid, { selectedId: id })}
              onToggle={() => patch(entry.uid, { expanded: !entry.expanded })}
              onPickSearched={c => addCandidate(entry.uid, c)}
            />
          ))}

          {/* Processed (imported + auto-skipped) — collapsed by default */}
          {processedEntries.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <button
                onClick={() => setShowProcessed(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                {showProcessed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span className="font-medium">Processed</span>
                <span className="text-gray-400">·</span>
                {doneCount > 0 && <span className="text-green-600">{doneCount} imported</span>}
                {doneCount > 0 && skippedCount > 0 && <span className="text-gray-300">/</span>}
                {skippedCount > 0 && <span className="text-gray-500">{skippedCount} sent to Review Later</span>}
              </button>
              {showProcessed && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {processedEntries.map(entry => <ProcessedRow key={entry.uid} entry={entry} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {entries.length > 0 && (
        <div className="sticky bottom-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          {busy ? (
            /* While running — show status + Cancel */
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700 flex items-center gap-2 min-w-0">
                <Loader2 size={15} className="animate-spin flex-shrink-0" />
                <span className="truncate">
                  {cancelled
                    ? 'Stopping after the current file…'
                    : autoImporting ? `Importing… (${doneCount + reviewCount + skippedCount + errorCount}/${entries.length})`
                    : processing ? 'Matching files…'
                    : 'Importing selected…'}
                </span>
              </span>
              <button
                onClick={requestCancel}
                disabled={cancelled}
                className="flex items-center gap-1.5 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
              >
                <X size={14} /> {cancelled ? 'Stopping…' : 'Cancel'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Step 2 — start the import */}
              {idleCount > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    onClick={autoImportAll}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 font-medium"
                  >
                    <Zap size={15} /> Start Import ({idleCount} file{idleCount !== 1 ? 's' : ''})
                  </button>
                  <button onClick={processAll} className="text-sm text-gray-500 hover:text-black underline text-left" title="Match files to recipes without importing anything yet">
                    Preview matches first
                  </button>
                  <button onClick={() => { setEntries([]); setAutoSummary(null) }} className="sm:ml-auto text-sm text-gray-400 hover:text-red-500 flex items-center gap-1">
                    <X size={13} /> Remove all
                  </button>
                </div>
              )}

              {/* Step 3 — review + import the flagged ones */}
              {reviewCount > 0 && (
                <div className={`flex flex-col sm:flex-row sm:items-center gap-3 ${idleCount > 0 ? 'border-t border-gray-100 pt-3' : ''}`}>
                  <span className="text-sm text-gray-600">
                    {readyCount > 0
                      ? `${readyCount} of ${reviewCount} flagged file${reviewCount !== 1 ? 's' : ''} ready to import.`
                      : `${reviewCount} file${reviewCount !== 1 ? 's' : ''} need review above — pick a recipe or skip.`}
                  </span>
                  {readyCount > 0 && (
                    <button
                      onClick={uploadSelected}
                      className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 font-medium sm:ml-auto"
                    >
                      <Upload size={15} /> Import {readyCount} selected
                    </button>
                  )}
                </div>
              )}

              {/* Nothing left to do */}
              {idleCount === 0 && reviewCount === 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-600 flex items-center gap-1.5">
                    <CheckCircle size={15} className="text-green-500" /> All files processed.
                  </span>
                  <button onClick={() => { setEntries([]); setAutoSummary(null) }} className="text-sm text-gray-500 hover:text-black flex items-center gap-1">
                    <X size={13} /> Clear list
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── card component ───────────────────────────────────────────────────────────

const PHASE_LABEL: Record<Phase, string> = {
  idle:       'Queued',
  extracting: 'Extracting…',
  matching:   'Searching…',
  ready:      'Needs review',
  uploading:  'Uploading…',
  done:       'Imported',
  skipped:    'Review Later',
  error:      'Error',
}

const PHASE_CLASS: Record<Phase, string> = {
  idle:       'text-gray-500 bg-gray-100',
  extracting: 'text-blue-700 bg-blue-50',
  matching:   'text-purple-700 bg-purple-50',
  ready:      'text-amber-700 bg-amber-50',
  uploading:  'text-blue-700 bg-blue-50',
  done:       'text-green-700 bg-green-50',
  skipped:    'text-gray-600 bg-gray-100',
  error:      'text-red-700 bg-red-50',
}

// ─── compact row for processed (imported / auto-skipped) files ──────────────────

function ProcessedRow({ entry }: { entry: FileEntry }) {
  const skipped = entry.phase === 'skipped'
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 text-sm">
      {skipped
        ? <SkipForward size={13} className="text-gray-400 flex-shrink-0" />
        : <CheckCircle size={13} className="text-green-500 flex-shrink-0" />}
      <span className="text-gray-700 truncate flex-1 min-w-0">{entry.file.name}</span>
      <span className="text-xs text-gray-400 truncate max-w-[55%] text-right">
        {skipped ? (entry.skipNote || 'Sent to Review Later') : 'Imported'}
      </span>
    </div>
  )
}

function EntryCard({
  entry, onRemove, onSelect, onToggle, onPickSearched,
}: {
  entry: FileEntry
  onRemove: () => void
  onSelect: (id: string | null) => void
  onToggle: () => void
  onPickSearched: (c: Candidate) => void
}) {
  const spinning = entry.phase === 'extracting' || entry.phase === 'matching' || entry.phase === 'uploading'
  const expandable = entry.phase === 'ready'
  const matchedName = entry.candidates?.find(c => c.id === entry.selectedId)
  const noMatch = entry.phase === 'ready' && (!entry.candidates || entry.candidates.length === 0)
  const ambiguous = entry.phase === 'ready' && entry.candidates && entry.candidates.length > 1
  const dup = entry.phase === 'ready' && !!entry.candidates && entry.candidates.length === 1 && !!entry.candidates[0].has_text
  const reviewReason =
    noMatch   ? 'No matching recipe found — search for one or skip'
    : ambiguous ? `${entry.candidates!.length} possible matches — pick the right one`
    : dup       ? 'Matched recipe already has text — importing will overwrite it'
    : 'Confirm the matched recipe below'

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      entry.phase === 'done'  ? 'border-green-200' :
      entry.phase === 'error' ? 'border-red-200' :
      dup                     ? 'border-orange-300' :
      (noMatch || ambiguous)  ? 'border-amber-300' : 'border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <FileText size={15} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">{entry.file.name}</span>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-1 ${PHASE_CLASS[entry.phase]}`}>
          {spinning && <Loader2 size={10} className="animate-spin" />}
          {PHASE_LABEL[entry.phase]}
        </span>

        {entry.phase === 'done'  && <CheckCircle size={15} className="text-green-500 flex-shrink-0" />}
        {entry.phase === 'error' && <XCircle     size={15} className="text-red-500   flex-shrink-0" />}

        {expandable && (
          <button onClick={onToggle} className="text-gray-400 hover:text-gray-700 flex-shrink-0">
            {entry.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        {entry.phase !== 'uploading' && entry.phase !== 'done' && (
          <button onClick={onRemove} className="text-gray-300 hover:text-red-400 flex-shrink-0">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Why it needs review — always visible for ready items */}
      {entry.phase === 'ready' && (
        <div className={`border-t px-4 py-2 flex items-center gap-1.5 text-xs ${
          dup ? 'border-orange-100 bg-orange-50 text-orange-800' : 'border-amber-100 text-amber-700'
        }`}>
          <AlertCircle size={12} className="flex-shrink-0" />
          <span className="font-medium">Needs review:</span> {reviewReason}
        </div>
      )}

      {/* Collapsed ready state — show brief match info */}
      {!entry.expanded && entry.phase === 'ready' && (
        <div onClick={onToggle} className="border-t border-gray-100 px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-50">
          {matchedName ? (
            <>
              <span className="text-xs text-gray-400">→</span>
              <span className="text-xs text-gray-500 font-mono">#{matchedName.sl_no}</span>
              <span className="text-xs text-gray-700 truncate flex-1">{matchedName.recipe_name}</span>
              {matchedName.has_text && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex-shrink-0">has text</span>}
              <span className="text-xs text-gray-400 flex-shrink-0">click to review</span>
            </>
          ) : (
            <span className="text-xs text-gray-500 flex items-center gap-1.5">Click to choose a recipe or skip</span>
          )}
        </div>
      )}

      {/* Error */}
      {entry.phase === 'error' && entry.errorMsg && (
        <div className="border-t border-red-100 px-4 py-2.5 text-xs text-red-600 flex items-center gap-1.5">
          <AlertCircle size={12} /> {entry.errorMsg}
        </div>
      )}

      {/* Done preview */}
      {entry.phase === 'done' && entry.formattedText && (
        <div className="border-t border-green-100 px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Formatted &amp; Saved</p>
          <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto leading-relaxed">
            {entry.formattedText.slice(0, 600)}{entry.formattedText.length > 600 ? '\n…' : ''}
          </pre>
        </div>
      )}

      {/* Expanded panel */}
      {entry.expanded && entry.phase === 'ready' && (
        <div className="border-t border-amber-100 px-4 py-4 space-y-4 bg-amber-50/30">
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Choose Recipe Match</p>

            {entry.candidates && entry.candidates.length > 0 ? (
              <div className="space-y-1.5">
                {entry.candidates.map(c => {
                  const active = entry.selectedId === c.id
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        active ? 'border-black bg-white' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <input type="radio" name={`m-${entry.uid}`} checked={active} onChange={() => onSelect(c.id)} className="sr-only" />
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${active ? 'border-black bg-black' : 'border-gray-300'}`} />
                      <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">#{c.sl_no}</span>
                      <span className="text-sm text-gray-800 flex-1">{c.recipe_name}</span>
                      {c.has_text && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex-shrink-0">has text</span>}
                    </label>
                  )
                })}
                <label className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  entry.selectedId === null ? 'border-black bg-white' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}>
                  <input type="radio" name={`m-${entry.uid}`} checked={entry.selectedId === null} onChange={() => onSelect(null)} className="sr-only" />
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${entry.selectedId === null ? 'border-black bg-black' : 'border-gray-300'}`} />
                  <span className="text-sm text-gray-400 italic">Skip this file</span>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
                <AlertCircle size={14} />
                No matching recipes found — search for the right one below, or skip.
              </div>
            )}

            {/* Manual search — find a recipe that wasn't auto-matched */}
            <RecipeSearch
              selectedId={entry.selectedId}
              knownIds={new Set((entry.candidates ?? []).map(c => c.id))}
              onPick={onPickSearched}
            />
          </div>

          {entry.rawText && (
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Extracted Text</p>
              <pre className="text-xs text-gray-500 whitespace-pre-wrap bg-white rounded-lg p-3 max-h-40 overflow-y-auto leading-relaxed border border-gray-200">
                {entry.rawText.slice(0, 800)}{entry.rawText.length > 800 ? '\n…' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── inline recipe search (for ambiguous / no-match review cards) ───────────────

function RecipeSearch({
  selectedId, knownIds, onPick,
}: {
  selectedId?: string | null
  knownIds: Set<string>
  onPick: (c: Candidate) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [err, setErr] = useState('')

  async function search() {
    const q = query.trim()
    if (!q) return
    setSearching(true); setErr('')
    try {
      const res = await pb.collection('recipes').getList(1, 8, {
        filter: pb.filter('recipe_name ~ {:q}', { q }),
        fields: 'id,sl_no,recipe_name,recipe_copy:excerpt(1)',
        sort: 'recipe_name',
      })
      setResults(res.items.map(r => ({
        id: r.id as string, sl_no: r.sl_no as number, recipe_name: r.recipe_name as string,
        has_text: !!(r['recipe_copy'] && String(r['recipe_copy']).trim()),
      })))
    } catch {
      setErr('Search failed.')
    } finally {
      setSearching(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-gray-500 hover:text-black underline flex items-center gap-1">
        <Search size={12} /> Search for a different recipe
      </button>
    )
  }

  // Only show results that aren't already in the candidate list above.
  const fresh = results.filter(r => !knownIds.has(r.id))

  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
            autoFocus
            placeholder="Search a recipe by name…"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black focus:border-transparent"
          />
        </div>
        <button onClick={search} disabled={searching || !query.trim()} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 bg-white">
          {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}

      {fresh.length > 0 && (
        <div className="space-y-1.5">
          {fresh.map(c => (
            <label
              key={c.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                selectedId === c.id ? 'border-black bg-white' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <input type="radio" checked={selectedId === c.id} onChange={() => onPick(c)} className="sr-only" />
              <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${selectedId === c.id ? 'border-black bg-black' : 'border-gray-300'}`} />
              <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">#{c.sl_no}</span>
              <span className="text-sm text-gray-800 flex-1">{c.recipe_name}</span>
              {c.has_text && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex-shrink-0">has text</span>}
            </label>
          ))}
        </div>
      )}

      {!searching && query.trim() && results.length > 0 && fresh.length === 0 && (
        <p className="text-xs text-gray-400">All matches are already listed above.</p>
      )}
    </div>
  )
}
