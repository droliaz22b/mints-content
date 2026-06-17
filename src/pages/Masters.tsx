import { useState, useEffect, FormEvent } from 'react'
import { pb } from '../lib/pocketbase'
import type { Category, Tag } from '../types'
import { Plus, Trash2, Loader2, AlertCircle, RefreshCw } from 'lucide-react'

export default function Masters() {
  return (
    <div className="w-full max-w-3xl space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Masters</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage taxonomy — categories and tags used across all recipes.</p>
      </div>
      <CategoriesSection />
      <TagsSection />
    </div>
  )
}

function CategoriesSection() {
  const [items, setItems] = useState<Category[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [syncResult, setSyncResult] = useState<{ created: number; total: number } | null>(null)

  async function load() {
    try {
      const res = await pb.collection('categories').getFullList<Category>({ sort: 'name' })
      setItems(res)
    } catch { setError('Failed to load categories.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = input.trim()
    if (!name) return
    setSaving(true); setError('')
    try {
      await pb.collection('categories').create({ name })
      setInput('')
      await load()
    } catch { setError('Failed to add. Name may already exist.') }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    try {
      await pb.collection('categories').delete(id)
      await load()
    } catch { setError('Failed to delete.') }
  }

  async function syncFromRecipes() {
    setSyncing(true); setError(''); setSyncResult(null)
    try {
      const recipes = await pb.collection('recipes').getFullList({ fields: 'category' })
      const found = new Set<string>()
      for (const r of recipes) {
        if (r.category?.trim()) found.add(r.category.trim())
      }
      const existing = await pb.collection('categories').getFullList({ fields: 'name' })
      const existingLower = new Set(existing.map((c: Category) => c.name.toLowerCase()))
      const toCreate = [...found].filter(c => !existingLower.has(c.toLowerCase()))
      let created = 0
      for (const name of toCreate) {
        try { await pb.collection('categories').create({ name }); created++ } catch { /* duplicate */ }
      }
      setSyncResult({ created, total: found.size })
      await load()
    } catch { setError('Sync failed.') }
    finally { setSyncing(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-700">Categories</h2>
        <button
          onClick={syncFromRecipes}
          disabled={syncing}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {syncing ? 'Scanning recipes…' : 'Sync from Recipes'}
        </button>
      </div>
      {error && <ErrorBanner msg={error} />}
      {syncResult && (
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
          ✓ Done — {syncResult.created} new categories added ({syncResult.total} unique found across all recipes)
        </div>
      )}
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input value={input} onChange={e => setInput(e.target.value)} className="input flex-1" placeholder="New category name…" />
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </form>
      {loading ? <Spinner /> : (
        <ul className="divide-y divide-gray-100">
          {items.map(c => (
            <li key={c.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{c.name}</span>
              <button onClick={() => remove(c.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </li>
          ))}
          {items.length === 0 && <p className="text-sm text-gray-400 py-3 text-center">No categories yet.</p>}
        </ul>
      )}
    </div>
  )
}

const TAG_COLORS = [
  { label: 'Pink',   value: 'pink' },
  { label: 'Purple', value: 'purple' },
  { label: 'Blue',   value: 'blue' },
  { label: 'Green',  value: 'green' },
  { label: 'Amber',  value: 'amber' },
  { label: 'Red',    value: 'red' },
  { label: 'Teal',   value: 'teal' },
]

function TagsSection() {
  const [items, setItems] = useState<Tag[]>([])
  const [input, setInput] = useState('')
  const [color, setColor] = useState('pink')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [error, setError] = useState('')
  const [syncResult, setSyncResult] = useState<{ created: number; total: number } | null>(null)

  async function load() {
    try {
      const res = await pb.collection('tags').getFullList<Tag>({ sort: 'name' })
      setItems(res)
    } catch { setError('Failed to load tags.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = input.trim()
    if (!name) return
    setSaving(true); setError('')
    try {
      await pb.collection('tags').create({ name, color })
      setInput('')
      await load()
    } catch { setError('Failed to add. Name may already exist.') }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    try {
      await pb.collection('tags').delete(id)
      await load()
    } catch { setError('Failed to delete.') }
  }

  async function syncFromRecipes() {
    setSyncing(true); setError(''); setSyncResult(null); setSyncProgress('Reading all recipes…')
    try {
      // Fetch all recipes (paginated automatically by PocketBase SDK)
      const recipes = await pb.collection('recipes').getFullList({ fields: 'tags' })
      setSyncProgress(`Found ${recipes.length} recipes, collecting tags…`)

      // Collect every unique tag across all recipes
      const found = new Set<string>()
      for (const r of recipes) {
        for (const t of (r.tags || [])) {
          if (t?.trim()) found.add(t.trim())
        }
      }

      setSyncProgress(`${found.size} unique tags found — checking collection…`)

      // Get tags already in the collection
      const existing = await pb.collection('tags').getFullList({ fields: 'name' })
      const existingLower = new Set(existing.map((t: Tag) => t.name.toLowerCase()))

      const toCreate = [...found].filter(t => !existingLower.has(t.toLowerCase()))
      setSyncProgress(`Adding ${toCreate.length} new tags…`)

      let created = 0
      for (const name of toCreate) {
        try { await pb.collection('tags').create({ name }); created++ } catch { /* duplicate race */ }
      }

      setSyncResult({ created, total: found.size })
      setSyncProgress('')
      await load()
    } catch { setError('Sync failed.') }
    finally { setSyncing(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-700">Tags</h2>
          <p className="text-xs text-gray-400 mt-0.5">{items.length} tags in collection</p>
        </div>
        <button
          onClick={syncFromRecipes}
          disabled={syncing}
          className="flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {syncing ? 'Syncing…' : 'Sync from Recipes'}
        </button>
      </div>

      {error && <ErrorBanner msg={error} />}

      {syncing && syncProgress && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
          <Loader2 size={11} className="animate-spin flex-shrink-0" /> {syncProgress}
        </div>
      )}

      {syncResult && !syncing && (
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
          ✓ Done — <strong>{syncResult.created} new tags added</strong> ({syncResult.total} unique tags found across all recipes)
        </div>
      )}

      <form onSubmit={add} className="space-y-2 mb-4">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} className="input flex-1" placeholder="New tag name…" />
          <select value={color} onChange={e => setColor(e.target.value)} className="input w-24 sm:w-28 flex-shrink-0">
            {TAG_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add Tag
        </button>
      </form>

      {loading ? <Spinner /> : (
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {items.map(t => (
            <li key={t.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{t.name}</span>
              <button onClick={() => remove(t.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </li>
          ))}
          {items.length === 0 && <p className="text-sm text-gray-400 py-3 text-center">No tags yet.</p>}
        </ul>
      )}
    </div>
  )
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
      <AlertCircle size={14} /> {msg}
    </div>
  )
}

function Spinner() {
  return <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
}
