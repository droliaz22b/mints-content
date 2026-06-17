import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { pb } from '../lib/pocketbase'
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  AlertCircle, ChevronDown, ChevronUp, X, ArrowLeft, Eye, EyeOff, FolderOpen, Zap,
} from 'lucide-react'

interface Candidate { id: string; sl_no: number; recipe_name: string }

type Phase = 'idle' | 'extracting' | 'matching' | 'ready' | 'uploading' | 'done' | 'error'

interface FileEntry {
  uid: string
  file: File
  phase: Phase
  rawText?: string
  candidates?: Candidate[]
  selectedId?: string | null   // null = explicit skip
  formattedText?: string
  errorMsg?: string
  expanded: boolean
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer } as never)
  return result.value.trim()
}

async function findCandidates(filename: string): Promise<Candidate[]> {
  const name = filename.replace(/\.docx$/i, '').trim().replace(/"/g, '')

  const run = async (filter: string) => {
    const res = await pb.collection('recipes').getList<Candidate>(1, 6, {
      filter,
      fields: 'id,sl_no,recipe_name',
      sort: 'sl_no',
    })
    return res.items
  }

  let hits = await run(`recipe_name ~ "${name}"`)
  if (hits.length) return hits

  const words = name.split(/\s+/).filter(w => w.length > 3)
  if (words.length >= 2) {
    hits = await run(words.map(w => `recipe_name ~ "${w}"`).join(' && '))
    if (hits.length) return hits
  }

  if (words.length >= 2) {
    hits = await run(words.slice(0, 2).map(w => `recipe_name ~ "${w}"`).join(' && '))
    if (hits.length) return hits
  }

  if (words.length >= 1) {
    hits = await run(`recipe_name ~ "${words[0]}"`)
  }
  return hits
}

async function formatWithAI(
  rawText: string, recipeName: string, apiKey: string
): Promise<{ recipe: string; tags: string[] }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a recipe editor. Given raw recipe text, do two things and return JSON.

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
- Keep all original content — do not add or remove steps`,
        },
        { role: 'user', content: `Recipe name: "${recipeName}"\n\n${rawText}` },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 120)}`)
  }
  const data = await res.json()
  const parsed = JSON.parse(data.choices[0].message.content.trim())
  return {
    recipe: (parsed.recipe || '').trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean)
      : [],
  }
}

// ─── main component ──────────────────────────────────────────────────────────

export default function RecipeImport() {
  const navigate = useNavigate()
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('mints_openai_key') || '')
  const [showKey, setShowKey] = useState(false)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [autoImporting, setAutoImporting] = useState(false)
  const [autoSummary, setAutoSummary] = useState<{ imported: number; review: number; errors: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [folderLoading, setFolderLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
    formatted: string, knownTags: Set<string>
  ) {
    const existingLower = new Set(existingTags.map((t: string) => t.toLowerCase()))
    const newTags = aiTags.filter(t => !existingLower.has(t))
    const mergedTags = [...existingTags, ...newTags]
    for (const tag of newTags) {
      if (!knownTags.has(tag.toLowerCase())) {
        await pb.collection('tags').create({ name: tag }).catch(() => {})
        knownTags.add(tag.toLowerCase())
      }
    }
    await pb.collection('recipes').update(recipeId, { recipe_copy: formatted, tags: mergedTags })
  }

  // ── Auto-Import All: uploads clear matches, flags ambiguous for review ────
  async function autoImportAll() {
    if (!apiKey) { alert('Enter your OpenAI API key first.'); return }
    const queue = entries.filter(e => e.phase === 'idle')
    if (!queue.length) return
    setAutoImporting(true)
    setAutoSummary(null)

    const tagRecords = await pb.collection('tags').getFullList({ fields: 'name' }).catch(() => [])
    const knownTags = new Set(tagRecords.map((t) => (t['name'] as string || '').toLowerCase()))

    let imported = 0, review = 0, errors = 0

    for (const entry of queue) {
      patch(entry.uid, { phase: 'extracting' })
      let rawText: string
      try {
        rawText = await extractDocx(entry.file)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Could not read .docx file.' })
        errors++; continue
      }

      patch(entry.uid, { phase: 'matching', rawText })
      let candidates: Candidate[] = []
      try {
        candidates = await findCandidates(entry.file.name)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Recipe search failed.' })
        errors++; continue
      }

      if (candidates.length === 1) {
        // Exactly one match — auto-upload immediately
        const match = candidates[0]
        patch(entry.uid, { phase: 'uploading', candidates, selectedId: match.id })
        try {
          const { recipe: formatted, tags: aiTags } = await formatWithAI(rawText, match.recipe_name, apiKey)
          const current = await pb.collection('recipes').getOne(match.id, { fields: 'tags' })
          const existing = Array.isArray(current.tags) ? current.tags as string[] : []
          await applyTagsAndUpload(match.id, existing, aiTags, formatted, knownTags)
          patch(entry.uid, { phase: 'done', formattedText: formatted })
          imported++
        } catch (err) {
          patch(entry.uid, { phase: 'error', errorMsg: err instanceof Error ? err.message : 'Upload failed' })
          errors++
        }
      } else {
        // 0 or 2+ matches — flag for manual review, expand so user sees them
        patch(entry.uid, {
          phase: 'ready',
          rawText,
          candidates,
          selectedId: candidates.length > 0 ? candidates[0].id : null,
          expanded: true,
        })
        review++
      }
    }

    setAutoSummary({ imported, review, errors })
    setAutoImporting(false)
  }

  // ── Match only (no upload) — review all before uploading ─────────────────
  const processAll = useCallback(async () => {
    const queue = entries.filter(e => e.phase === 'idle')
    if (!queue.length) return
    setProcessing(true)

    for (const entry of queue) {
      patch(entry.uid, { phase: 'extracting' })
      let rawText: string
      try {
        rawText = await extractDocx(entry.file)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Could not read .docx file.' })
        continue
      }

      patch(entry.uid, { phase: 'matching', rawText })
      let candidates: Candidate[] = []
      try {
        candidates = await findCandidates(entry.file.name)
      } catch {
        patch(entry.uid, { phase: 'error', errorMsg: 'Recipe search failed.' })
        continue
      }

      patch(entry.uid, {
        phase: 'ready',
        rawText,
        candidates,
        selectedId: candidates.length >= 1 ? candidates[0].id : null,
        expanded: candidates.length !== 1,
      })
    }

    setProcessing(false)
  }, [entries])

  // ── Upload manually selected ready entries ────────────────────────────────
  async function uploadSelected() {
    if (!apiKey) { alert('Enter your OpenAI API key first.'); return }
    const queue = entries.filter(e => e.phase === 'ready' && e.selectedId)
    if (!queue.length) return
    setUploading(true)

    const tagRecords = await pb.collection('tags').getFullList({ fields: 'name' }).catch(() => [])
    const knownTags = new Set(tagRecords.map((t) => (t['name'] as string || '').toLowerCase()))

    for (const entry of queue) {
      if (!entry.selectedId || !entry.rawText || !entry.candidates) continue
      const match = entry.candidates.find(c => c.id === entry.selectedId)
      if (!match) continue

      patch(entry.uid, { phase: 'uploading' })
      try {
        const { recipe: formatted, tags: aiTags } = await formatWithAI(entry.rawText, match.recipe_name, apiKey)
        const current = await pb.collection('recipes').getOne(match.id, { fields: 'tags' })
        const existing = Array.isArray(current.tags) ? current.tags as string[] : []
        await applyTagsAndUpload(match.id, existing, aiTags, formatted, knownTags)
        patch(entry.uid, { phase: 'done', formattedText: formatted })
      } catch (err) {
        patch(entry.uid, { phase: 'error', errorMsg: err instanceof Error ? err.message : 'Upload failed' })
      }
    }

    setUploading(false)
  }

  const busy = processing || uploading || autoImporting
  const idleCount  = entries.filter(e => e.phase === 'idle').length
  const readyCount = entries.filter(e => e.phase === 'ready' && e.selectedId).length
  const doneCount  = entries.filter(e => e.phase === 'done').length
  const errorCount = entries.filter(e => e.phase === 'error').length
  const reviewCount = entries.filter(e => e.phase === 'ready').length

  return (
    <div className="w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Import from Docs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload .docx files → auto-import clear matches → review the rest</p>
        </div>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800">
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* API key */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">OpenAI API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); localStorage.setItem('mints_openai_key', e.target.value) }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="sk-proj-..."
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">Saved in your browser. Only used for AI formatting.</p>
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
          {errorCount > 0 && <span className="text-red-600">✕ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
          <button onClick={() => { setEntries([]); setAutoSummary(null) }} className="ml-auto text-gray-400 hover:text-gray-700 text-xs">
            Clear all
          </button>
        </div>
      )}

      {/* Auto-import result banner */}
      {autoSummary && !autoImporting && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 mb-4 space-y-1">
          {autoSummary.imported > 0 && (
            <p className="text-sm text-green-700 flex items-center gap-2">
              <CheckCircle size={14} />
              {autoSummary.imported} recipe{autoSummary.imported !== 1 ? 's' : ''} auto-imported successfully
            </p>
          )}
          {autoSummary.review > 0 && (
            <p className="text-sm text-amber-700 flex items-center gap-2">
              <AlertCircle size={14} />
              {autoSummary.review} file{autoSummary.review !== 1 ? 's' : ''} need your review — see below
            </p>
          )}
          {autoSummary.errors > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-2">
              <XCircle size={14} />
              {autoSummary.errors} error{autoSummary.errors !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* File cards — review-needed first, then done */}
      {entries.length > 0 && (
        <div className="space-y-2 mb-5">
          {/* Show files needing review at top */}
          {entries.filter(e => e.phase === 'ready').map(entry => (
            <EntryCard
              key={entry.uid}
              entry={entry}
              onRemove={() => setEntries(prev => prev.filter(e => e.uid !== entry.uid))}
              onSelect={id => patch(entry.uid, { selectedId: id })}
              onToggle={() => patch(entry.uid, { expanded: !entry.expanded })}
            />
          ))}
          {/* Then all other entries */}
          {entries.filter(e => e.phase !== 'ready').map(entry => (
            <EntryCard
              key={entry.uid}
              entry={entry}
              onRemove={() => setEntries(prev => prev.filter(e => e.uid !== entry.uid))}
              onSelect={id => patch(entry.uid, { selectedId: id })}
              onToggle={() => patch(entry.uid, { expanded: !entry.expanded })}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-3 justify-end">
          {idleCount > 0 && (
            <button
              onClick={processAll}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {processing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {processing ? 'Matching…' : `Match only (${idleCount})`}
            </button>
          )}
          {idleCount > 0 && (
            <button
              onClick={autoImportAll}
              disabled={busy || !apiKey}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              title={!apiKey ? 'Enter your OpenAI API key first' : 'Auto-import clear matches, flag ambiguous for review'}
            >
              {autoImporting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {autoImporting ? 'Auto-importing…' : `Auto-Import All (${idleCount})`}
            </button>
          )}
          {readyCount > 0 && (
            <button
              onClick={uploadSelected}
              disabled={busy || !apiKey}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              title={!apiKey ? 'Enter your OpenAI API key first' : ''}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Uploading…' : `Upload selected (${readyCount})`}
            </button>
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
  error:      'Error',
}

const PHASE_CLASS: Record<Phase, string> = {
  idle:       'text-gray-500 bg-gray-100',
  extracting: 'text-blue-700 bg-blue-50',
  matching:   'text-purple-700 bg-purple-50',
  ready:      'text-amber-700 bg-amber-50',
  uploading:  'text-blue-700 bg-blue-50',
  done:       'text-green-700 bg-green-50',
  error:      'text-red-700 bg-red-50',
}

function EntryCard({
  entry, onRemove, onSelect, onToggle,
}: {
  entry: FileEntry
  onRemove: () => void
  onSelect: (id: string | null) => void
  onToggle: () => void
}) {
  const spinning = entry.phase === 'extracting' || entry.phase === 'matching' || entry.phase === 'uploading'
  const expandable = entry.phase === 'ready'
  const matchedName = entry.candidates?.find(c => c.id === entry.selectedId)
  const noMatch = entry.phase === 'ready' && (!entry.candidates || entry.candidates.length === 0)
  const ambiguous = entry.phase === 'ready' && entry.candidates && entry.candidates.length > 1

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      entry.phase === 'done'  ? 'border-green-200' :
      entry.phase === 'error' ? 'border-red-200' :
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

      {/* Collapsed ready state — show brief match info */}
      {!entry.expanded && entry.phase === 'ready' && (
        <div onClick={onToggle} className="border-t border-amber-100 px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-amber-50">
          {noMatch ? (
            <span className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertCircle size={12} /> No match found — click to skip or review
            </span>
          ) : ambiguous ? (
            <span className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertCircle size={12} /> {entry.candidates!.length} possible matches — click to choose
            </span>
          ) : matchedName ? (
            <>
              <span className="text-xs text-gray-400">→</span>
              <span className="text-xs text-gray-500 font-mono">#{matchedName.sl_no}</span>
              <span className="text-xs text-gray-700 truncate flex-1">{matchedName.recipe_name}</span>
            </>
          ) : (
            <span className="text-xs text-red-500">No recipe selected — click to review</span>
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
                      <span className="text-sm text-gray-800">{c.recipe_name}</span>
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
                No matching recipes found.
                <button onClick={() => onSelect(null)} className="ml-auto text-xs text-gray-500 underline hover:text-gray-800">Skip</button>
              </div>
            )}
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
