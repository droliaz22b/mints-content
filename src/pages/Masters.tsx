import { useState, useEffect, FormEvent } from 'react'
import { pb } from '../lib/pocketbase'
import type { Category, Tag } from '../types'
import { Plus, Trash2, Loader2, AlertCircle } from 'lucide-react'

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
  const [error, setError] = useState('')

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

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
      <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-700 mb-4">Categories</h2>
      {error && <ErrorBanner msg={error} />}
      <form onSubmit={add} className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          className="input flex-1"
          placeholder="New category name…"
        />
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
  const [error, setError] = useState('')

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

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6">
      <h2 className="font-semibold text-xs uppercase tracking-wide text-gray-700 mb-4">Tags</h2>
      {error && <ErrorBanner msg={error} />}
      <form onSubmit={add} className="space-y-2 mb-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            className="input flex-1"
            placeholder="New tag name…"
          />
          <select value={color} onChange={e => setColor(e.target.value)} className="input w-24 sm:w-28 flex-shrink-0">
            {TAG_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add Tag
        </button>
      </form>
      {loading ? <Spinner /> : (
        <ul className="divide-y divide-gray-100">
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
