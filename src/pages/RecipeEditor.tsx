import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { pb } from '../lib/pocketbase'
import type { Recipe, RecipeStatus } from '../types'
import { Save, X, AlertCircle, Loader2 } from 'lucide-react'

const STATUSES: RecipeStatus[] = ['Draft', 'Ready', 'Edited', 'Posted', 'Uploaded', 'Done']
const ALL_PLATFORMS = ['Facebook', 'YouTube', 'Instagram']

const EMPTY: Omit<Recipe, 'id' | 'created' | 'updated'> = {
  sl_no: 0,
  recipe_name: '',
  date: '',
  editor: '',
  category: '',
  tags: [],
  instagram_format: '',
  youtube_format: '',
  fb_editor: '',
  docs: '',
  thumbnails: '',
  website_draft: '',
  recipe_copy: '',
  status: 'Draft',
  platforms: [],
}

export default function RecipeEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [form, setForm] = useState(EMPTY)
  const [tagInput, setTagInput] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    pb.collection('categories').getFullList({ sort: 'name' }).then(res => setCategories(res.map(c => c.name as string))).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    pb.collection('recipes').getOne<Recipe>(id)
      .then(r => {
        setForm({
          sl_no: r.sl_no,
          recipe_name: r.recipe_name,
          date: r.date || '',
          editor: r.editor || '',
          category: r.category || '',
          tags: r.tags || [],
          instagram_format: r.instagram_format || '',
          youtube_format: r.youtube_format || '',
          fb_editor: r.fb_editor || '',
          docs: r.docs || '',
          thumbnails: r.thumbnails || '',
          website_draft: r.website_draft || '',
          recipe_copy: r.recipe_copy || '',
          status: r.status || 'Draft',
          platforms: r.platforms || [],
        })
      })
      .catch(() => setError('Recipe not found.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function set<K extends keyof typeof EMPTY>(key: K, value: typeof EMPTY[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t])
    setTagInput('')
  }

  function removeTag(t: string) {
    set('tags', form.tags.filter(x => x !== t))
  }

  function togglePlatform(p: string) {
    set('platforms', form.platforms.includes(p) ? form.platforms.filter(x => x !== p) : [...form.platforms, p])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.recipe_name.trim()) return setError('Recipe name is required.')
    if (!form.sl_no || form.sl_no < 1) return setError('SL.No must be a positive number.')
    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await pb.collection('recipes').update(id!, form)
      } else {
        await pb.collection('recipes').create(form)
      }
      navigate('/')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed.'
      if (msg.includes('sl_no')) setError('SL.No already exists. Use a unique number.')
      else setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={24} className="animate-spin" /></div>

  return (
    <div className="w-full max-w-3xl">
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{isEdit ? 'Edit Recipe' : 'New Recipe'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{isEdit ? `Editing #${form.sl_no}` : 'Add a new recipe to the library'}</p>
        </div>
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100">
          <X size={16} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Core fields */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Core Details</h2>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Field label="SL.No *" hint="Unique ID">
              <input
                type="number"
                value={form.sl_no || ''}
                onChange={e => set('sl_no', Number(e.target.value))}
                className="input"
                min={1}
                placeholder="e.g. 1065"
                required
              />
            </Field>
            <Field label="Status *">
              <select value={form.status} onChange={e => set('status', e.target.value as RecipeStatus)} className="input">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Recipe Name *">
            <input
              type="text"
              value={form.recipe_name}
              onChange={e => set('recipe_name', e.target.value)}
              className="input"
              placeholder="e.g. Instant Kurkure"
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Field label="Category">
              <select value={form.category} onChange={e => set('category', e.target.value)} className="input">
                <option value="">— Select —</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="input" />
            </Field>
          </div>
        </div>

        {/* Tags */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Tags</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              className="input flex-1"
              placeholder="Type a tag and press Enter"
            />
            <button type="button" onClick={addTag} className="px-3 sm:px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0">Add</button>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 rounded-full">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="text-gray-400 hover:text-red-500 ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Platforms */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Platforms</h2>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {ALL_PLATFORMS.map(p => (
              <label key={p} className={`flex items-center gap-2 px-3 sm:px-4 py-2 border rounded-lg cursor-pointer transition-colors text-sm ${form.platforms.includes(p) ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'}`}>
                <input type="checkbox" checked={form.platforms.includes(p)} onChange={() => togglePlatform(p)} className="sr-only" />
                {p}
              </label>
            ))}
          </div>
        </div>

        {/* Social formats */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Social Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <Field label="Instagram Format">
              <input type="text" value={form.instagram_format} onChange={e => set('instagram_format', e.target.value)} className="input" placeholder="Reels, Feed…" />
            </Field>
            <Field label="YouTube Format">
              <input type="text" value={form.youtube_format} onChange={e => set('youtube_format', e.target.value)} className="input" placeholder="Short, Video…" />
            </Field>
            <Field label="FB Editor">
              <input type="text" value={form.fb_editor} onChange={e => set('fb_editor', e.target.value)} className="input" placeholder="RKK, Mints…" />
            </Field>
          </div>
          <Field label="Editor Name">
            <input type="text" value={form.editor} onChange={e => set('editor', e.target.value)} className="input" placeholder="Editor who prepared this" />
          </Field>
        </div>

        {/* Checklist */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Checklist</h2>
          <div className="flex flex-wrap gap-4 sm:gap-6">
            {(['docs', 'thumbnails', 'website_draft'] as const).map(field => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[field] === 'Done'}
                  onChange={e => set(field, e.target.checked ? 'Done' : '')}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700 capitalize">{field.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Recipe copy */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-3">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recipe Copy</h2>
          <textarea
            value={form.recipe_copy}
            onChange={e => set('recipe_copy', e.target.value)}
            className="input w-full h-32 resize-y"
            placeholder="Paste or write the recipe text here…"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pb-6 sm:pb-8">
          <button type="button" onClick={() => navigate('/')} className="px-4 sm:px-5 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Recipe'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {hint && <span className="text-xs text-gray-400 font-normal ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
