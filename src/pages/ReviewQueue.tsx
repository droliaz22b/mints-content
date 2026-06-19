import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { pb } from '../lib/pocketbase'
import { formatRecipeWithAI, attachToRecipe, loadCategoryTaxonomy } from '../lib/recipeImport'
import type { ReviewItem, ReviewCandidate, ReviewReason } from '../types'
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle, Search, Trash2,
  ChevronDown, ChevronUp, FileText, Copy, Check,
} from 'lucide-react'

const REASON_LABEL: Record<ReviewReason, string> = {
  no_match: 'No match found',
  multiple_matches: 'Multiple matches',
  duplicate: 'Already has text',
  error: 'Import error',
}

const REASON_STYLE: Record<ReviewReason, string> = {
  no_match: 'bg-gray-100 text-gray-700',
  multiple_matches: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-orange-100 text-orange-800',
  error: 'bg-red-100 text-red-700',
}

export default function ReviewQueue() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await pb.collection('review_queue').getFullList<ReviewItem>({
        filter: 'status = "pending"',
        sort: '-created',
      })
      setItems(res)
    } catch {
      setError('Failed to load the review queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function removeFromList(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Review Later</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Recipe texts skipped during import — resolve, attach, or dismiss them here.
          </p>
        </div>
        <button onClick={() => navigate('/import')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800" title="Back to Import">
          <ArrowLeft size={16} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle size={28} className="mx-auto mb-3 text-green-500" />
          <p className="text-sm">Nothing to review. The queue is empty.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 px-1">{items.length} item{items.length !== 1 ? 's' : ''} pending</p>
          {items.map(item => (
            <ReviewCard key={item.id} item={item} onResolved={() => removeFromList(item.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Single review card ───────────────────────────────────────────────────────

function ReviewCard({ item, onResolved }: { item: ReviewItem; onResolved: () => void }) {
  const candidates: ReviewCandidate[] = Array.isArray(item.candidates) ? item.candidates : []
  const [expanded, setExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id || '')
  const [selectedName, setSelectedName] = useState<string>(candidates[0]?.recipe_name || '')
  const [busy, setBusy] = useState<'attach' | 'dismiss' | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  // Manual recipe search (for no-match / error items with no candidates)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ReviewCandidate[]>([])
  const [searching, setSearching] = useState(false)

  const selectedHasText =
    candidates.find(c => c.id === selectedId)?.has_text ||
    results.find(c => c.id === selectedId)?.has_text || false

  async function search() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = await pb.collection('recipes').getList(1, 8, {
        filter: pb.filter('recipe_name ~ {:q}', { q }),
        fields: 'id,sl_no,recipe_name,recipe_copy',
        sort: 'recipe_name',
      })
      setResults(res.items.map(r => ({
        id: r.id, sl_no: r.sl_no as number, recipe_name: r.recipe_name as string,
        has_text: !!(r.recipe_copy && String(r.recipe_copy).trim()),
      })))
    } catch {
      setErr('Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function formatAndAttach() {
    if (!selectedId) return
    setBusy('attach'); setErr('')
    try {
      const taxonomy = await loadCategoryTaxonomy()
      const { recipe: formatted, tags, categories } = await formatRecipeWithAI(item.raw_text, selectedName, taxonomy)
      await attachToRecipe(selectedId, formatted, tags, undefined, categories)
      await pb.collection('review_queue').update(item.id, { status: 'resolved', resolved_recipe: selectedId })
      onResolved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to format and attach.')
      setBusy(null)
    }
  }

  async function dismiss() {
    setBusy('dismiss'); setErr('')
    try {
      await pb.collection('review_queue').update(item.id, { status: 'dismissed' })
      onResolved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to dismiss.')
      setBusy(null)
    }
  }

  function copyText() {
    navigator.clipboard.writeText(item.raw_text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  function pick(id: string, name: string) {
    setSelectedId(id); setSelectedName(name)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate flex items-center gap-1.5">
            <FileText size={14} className="text-gray-400 flex-shrink-0" /> {item.file_name}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className={`text-xs px-2 py-0.5 rounded-full ${REASON_STYLE[item.reason]}`}>
              {REASON_LABEL[item.reason]}
            </span>
            {item.duplicate && item.reason !== 'duplicate' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">Possible duplicate</span>
            )}
          </div>
          {item.note && <p className="text-xs text-red-600 mt-1.5">{item.note}</p>}
        </div>
      </div>

      {/* Raw text preview */}
      {item.raw_text && (
        <div className="mt-3">
          <button onClick={() => setExpanded(v => !v)} className="text-xs text-gray-500 hover:text-black flex items-center gap-1">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide' : 'Show'} recipe text
          </button>
          {expanded && (
            <div className="relative mt-2">
              <button onClick={copyText} className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 bg-white/80 rounded p-1" title="Copy text">
                {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              </button>
              <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-64 overflow-y-auto font-sans text-gray-700">
                {item.raw_text}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Target recipe selection */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Attach to recipe</p>

        {candidates.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {candidates.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name={`cand-${item.id}`} checked={selectedId === c.id} onChange={() => pick(c.id, c.recipe_name)} />
                <span className="text-gray-400">#{c.sl_no}</span>
                <span className="truncate">{c.recipe_name}</span>
                {c.has_text && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex-shrink-0">has text</span>}
              </label>
            ))}
          </div>
        )}

        {/* Manual search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
              placeholder={candidates.length > 0 ? 'Or search a different recipe…' : 'Search a recipe by name…'}
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            />
          </div>
          <button onClick={search} disabled={searching || !query.trim()} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
          </button>
        </div>

        {results.length > 0 && (
          <div className="space-y-1.5 mt-2">
            {results.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name={`cand-${item.id}`} checked={selectedId === c.id} onChange={() => pick(c.id, c.recipe_name)} />
                <span className="text-gray-400">#{c.sl_no}</span>
                <span className="truncate">{c.recipe_name}</span>
                {c.has_text && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 flex-shrink-0">has text</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      {selectedHasText && (
        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 mt-3 flex items-center gap-1.5">
          <AlertCircle size={13} /> This recipe already has text — attaching will overwrite it.
        </p>
      )}

      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 mt-3">
        <button onClick={dismiss} disabled={busy !== null} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
          {busy === 'dismiss' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Dismiss
        </button>
        <button onClick={formatAndAttach} disabled={busy !== null || !selectedId} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
          {busy === 'attach' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          {busy === 'attach' ? 'Formatting…' : 'Format & Attach'}
        </button>
      </div>
    </div>
  )
}
