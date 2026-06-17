import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { pb } from '../lib/pocketbase'
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  AlertCircle, ChevronDown, ChevronUp, X, ArrowLeft, Eye, EyeOff,
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

  // 1. full phrase
  let hits = await run(`recipe_name ~ "${name}"`)
  if (hits.length) return hits

  // 2. all significant words
  const words = name.split(/\s+/).filter(w => w.length > 3)
  if (words.length >= 2) {
    hits = await run(words.map(w => `recipe_name ~ "${w}"`).join(' && '))
    if (hits.length) return hits
  }

  // 3. first two words only
  if (words.length >= 2) {
    hits = await run(words.slice(0, 2).map(w => `recipe_name ~ "${w}"`).join(' && '))
    if (hits.length) return hits
  }

  // 4. first word
  if (words.length >= 1) {
    hits = await run(`recipe_name ~ "${words[0]}"`)
  }
  return hits
}

async function formatWithAI(rawText: string, recipeName: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a recipe editor. Format and fix the grammar of recipe text.

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
- Use only markdown formatting (**, -, 1.) — no HTML`,
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
  return data.choices[0].message.content.trim()
}

// ─── main component ──────────────────────────────────────────────────────────

export default function RecipeImport() {
  const navigate = useNavigate()
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('mints_openai_key') || '')
  const [showKey, setShowKey] = useState(false)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

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

      const autoSelect = candidates.length === 1 ? candidates[0].id : candidates.length > 1 ? candidates[0].id : null
      patch(entry.uid, {
        phase: 'ready',
        rawText,
        candidates,
        selectedId: autoSelect,
        expanded: candidates.length !== 1,
      })
    }

    setProcessing(false)
  }, [entries])

  async function uploadAll() {
    if (!apiKey) { alert('Enter your OpenAI API key first.'); return }
    const queue = entries.filter(e => e.phase === 'ready' && e.selectedId)
    if (!queue.length) return
    setUploading(true)

    for (const entry of queue) {
      if (!entry.selectedId || !entry.rawText || !entry.candidates) continue
      const match = entry.candidates.find(c => c.id === entry.selectedId)
      if (!match) continue

      patch(entry.uid, { phase: 'uploading' })
      try {
        const formatted = await formatWithAI(entry.rawText, match.recipe_name, apiKey)
        await pb.collection('recipes').update(match.id, { recipe_copy: formatted })
        patch(entry.uid, { phase: 'done', formattedText: formatted })
      } catch (err) {
        patch(entry.uid, { phase: 'error', errorMsg: err instanceof Error ? err.message : 'Upload failed' })
      }
    }

    setUploading(false)
  }

  const idleCount  = entries.filter(e => e.phase === 'idle').length
  const readyCount = entries.filter(e => e.phase === 'ready' && e.selectedId).length
  const doneCount  = entries.filter(e => e.phase === 'done').length
  const errorCount = entries.filter(e => e.phase === 'error').length

  return (
    <div className="w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Import from Docs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload .docx files → match → format with AI → update recipes</p>
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
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
          dragging ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <Upload size={22} className={`mx-auto mb-2 ${dragging ? 'text-black' : 'text-gray-400'}`} />
        <p className="text-sm font-medium text-gray-700">Drop .docx files here</p>
        <p className="text-xs text-gray-400 mt-1">or click to browse — multiple files supported</p>
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
          {doneCount > 0  && <span className="text-green-600">✓ {doneCount} done</span>}
          {errorCount > 0 && <span className="text-red-600">✕ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
          {readyCount > 0 && <span className="text-amber-700">● {readyCount} ready to upload</span>}
          <button
            onClick={() => setEntries([])}
            className="ml-auto text-gray-400 hover:text-gray-700 text-xs"
          >
            Clear all
          </button>
        </div>
      )}

      {/* File cards */}
      {entries.length > 0 && (
        <div className="space-y-2 mb-5">
          {entries.map(entry => (
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
        <div className="flex gap-3 justify-end">
          {idleCount > 0 && (
            <button
              onClick={processAll}
              disabled={processing || uploading}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {processing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              {processing ? 'Processing…' : `Extract & Match (${idleCount})`}
            </button>
          )}
          {readyCount > 0 && (
            <button
              onClick={uploadAll}
              disabled={uploading || processing || !apiKey}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              title={!apiKey ? 'Enter your OpenAI API key first' : ''}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'Uploading…' : `Format & Upload (${readyCount})`}
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
  ready:      'Ready',
  uploading:  'Uploading…',
  done:       'Done',
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

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      entry.phase === 'done' ? 'border-green-200' :
      entry.phase === 'error' ? 'border-red-200' :
      noMatch ? 'border-amber-200' : 'border-gray-200'
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

      {/* Compact match summary (collapsed ready state) */}
      {!entry.expanded && entry.phase === 'ready' && (
        <div
          onClick={onToggle}
          className="border-t border-gray-100 px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-50"
        >
          {noMatch ? (
            <span className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertCircle size={12} /> No match found — click to skip or search manually
            </span>
          ) : matchedName ? (
            <>
              <span className="text-xs text-gray-400">→</span>
              <span className="text-xs text-gray-500 font-mono">#{matchedName.sl_no}</span>
              <span className="text-xs text-gray-700 truncate flex-1">{matchedName.recipe_name}</span>
              {entry.candidates && entry.candidates.length > 1 && (
                <span className="text-xs text-amber-600 flex-shrink-0">{entry.candidates.length} candidates</span>
              )}
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
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Candidates */}
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Match To Recipe</p>

            {entry.candidates && entry.candidates.length > 0 ? (
              <div className="space-y-1.5">
                {entry.candidates.map(c => {
                  const active = entry.selectedId === c.id
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        active ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input type="radio" name={`m-${entry.uid}`} checked={active} onChange={() => onSelect(c.id)} className="sr-only" />
                      <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${active ? 'border-black bg-black' : 'border-gray-300'}`} />
                      <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">#{c.sl_no}</span>
                      <span className="text-sm text-gray-800">{c.recipe_name}</span>
                    </label>
                  )
                })}

                {/* Skip option */}
                <label
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    entry.selectedId === null ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
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

          {/* Raw text preview */}
          {entry.rawText && (
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Extracted Text</p>
              <pre className="text-xs text-gray-500 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto leading-relaxed">
                {entry.rawText.slice(0, 800)}{entry.rawText.length > 800 ? '\n…' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
