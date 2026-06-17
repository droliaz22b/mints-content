import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { pb } from '../lib/pocketbase'
import { preprocessToMarkdown, FORMAT_SYSTEM_PROMPT } from '../lib/formatRecipe'
import type { Recipe, RecipeStatus } from '../types'
import { Save, X, AlertCircle, Loader2, Hash, Bold, List, ListOrdered, Heading2, Minus, Sparkles } from 'lucide-react'

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
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [recipeTab, setRecipeTab] = useState<'write' | 'preview'>('write')
  const [aiFormatting, setAiFormatting] = useState(false)
  const [ingredientSuggestions, setIngredientSuggestions] = useState<string[]>([])
  const [extractingIngredients, setExtractingIngredients] = useState(false)
  const tagRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLTextAreaElement>(null)

  async function extractIngredientTags() {
    const apiKey = localStorage.getItem('mints_openai_key')
    if (!apiKey) {
      alert('No OpenAI API key saved. Open Import Docs and enter your key first.')
      return
    }
    if (!form.recipe_copy.trim()) return
    setExtractingIngredients(true)
    setIngredientSuggestions([])
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a recipe ingredient analyzer. Identify the 3-6 most important MAIN ingredients from the recipe text.

Include: key proteins, vegetables, grains, dairy, nuts (e.g. paneer, rice, chicken, potato, coconut, bread, egg, onion, maida, atta, wheat, garlic, mushroom, lentil, banana, mango)
Exclude: ALL spices and seasonings (salt, turmeric, cumin, coriander, chili, pepper, cardamom, garam masala, oregano, etc.), oil, water, sugar, baking soda/powder, vinegar

Return ONLY a comma-separated list in lowercase. No explanation, no extra text.
Example output: paneer, onion, capsicum, maida`,
            },
            {
              role: 'user',
              content: `Recipe: "${form.recipe_name}"\n\n${form.recipe_copy}`,
            },
          ],
          max_tokens: 60,
        }),
      })
      if (!res.ok) throw new Error(`OpenAI ${res.status}`)
      const data = await res.json()
      const raw = data.choices[0].message.content.trim()
      const suggested = raw
        .split(',')
        .map((s: string) => s.trim().toLowerCase())
        .filter((s: string) => s.length > 1 && !form.tags.map(t => t.toLowerCase()).includes(s))
      setIngredientSuggestions(suggested)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Extraction failed.')
    } finally {
      setExtractingIngredients(false)
    }
  }

  async function formatWithAI() {
    const apiKey = localStorage.getItem('mints_openai_key')
    if (!apiKey) {
      alert('No OpenAI API key saved. Open Import Docs and enter your key first.')
      return
    }
    if (!form.recipe_copy.trim()) return
    setAiFormatting(true)
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: FORMAT_SYSTEM_PROMPT },
            { role: 'user', content: `Recipe name: "${form.recipe_name}"\n\n${form.recipe_copy}` },
          ],
        }),
      })
      if (!res.ok) throw new Error(`OpenAI ${res.status}`)
      const data = await res.json()
      set('recipe_copy', data.choices[0].message.content.trim())
      setRecipeTab('preview')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI formatting failed.')
    } finally {
      setAiFormatting(false)
    }
  }

  // Load categories and tags
  useEffect(() => {
    pb.collection('categories').getFullList({ sort: 'name' }).then(res => setCategories(res.map(c => c.name as string))).catch(() => {})
    pb.collection('tags').getFullList({ sort: 'name' }).then(res => setAllTags(res.map(t => t.name as string))).catch(() => {})
  }, [])

  // Auto-increment SL.No for new recipes
  useEffect(() => {
    if (isEdit) return
    pb.collection('recipes').getList<Recipe>(1, 1, { sort: '-sl_no' })
      .then(res => { if (res.items.length > 0) setForm(prev => ({ ...prev, sl_no: res.items[0].sl_no + 1 })) })
      .catch(() => {})
  }, [isEdit])

  // Tag autocomplete
  useEffect(() => {
    const q = tagInput.trim().toLowerCase()
    if (!q) { setTagSuggestions([]); return }
    setTagSuggestions(allTags.filter(t => t.toLowerCase().includes(q) && !form.tags.includes(t)).slice(0, 7))
  }, [tagInput, allTags, form.tags])

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

  function addTag(name?: string) {
    const t = (name ?? tagInput).trim()
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t])
    setTagInput('')
    setTagSuggestions([])
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
      // Sync any new tags to the tags collection so they appear in dashboard filters
      const knownLower = new Set(allTags.map(t => t.toLowerCase()))
      const newTags = form.tags.filter(t => !knownLower.has(t.toLowerCase()))
      await Promise.allSettled(newTags.map(t => pb.collection('tags').create({ name: t })))
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
            <Field label="SL.No *" hint="auto-filled, editable">
              <div className="relative">
                <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  value={form.sl_no || ''}
                  onChange={e => set('sl_no', Number(e.target.value))}
                  className="input pl-7"
                  min={1}
                  required
                />
              </div>
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
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Tags</h2>
            {form.recipe_copy.trim() && (
              <button
                type="button"
                onClick={extractIngredientTags}
                disabled={extractingIngredients}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
              >
                {extractingIngredients ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {extractingIngredients ? 'Extracting…' : 'Suggest from recipe'}
              </button>
            )}
          </div>

          {/* AI ingredient suggestions */}
          {ingredientSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
              <span className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide w-full mb-0.5">Suggested ingredients — click to add</span>
              {ingredientSuggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    addTag(s)
                    setIngredientSuggestions(prev => prev.filter(x => x !== s))
                  }}
                  className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-white border border-amber-200 text-amber-800 rounded-full hover:bg-amber-100 hover:border-amber-300 transition-colors"
                >
                  + {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIngredientSuggestions([])}
                className="ml-auto text-[10px] text-amber-500 hover:text-amber-700"
              >
                dismiss
              </button>
            </div>
          )}

          <div className="flex gap-2" ref={tagRef}>
            <div className="relative flex-1">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag() }
                  if (e.key === 'Escape') setTagSuggestions([])
                  if (e.key === 'ArrowDown' && tagSuggestions.length > 0) {
                    e.preventDefault()
                    const first = tagRef.current?.querySelector<HTMLButtonElement>('[data-suggestion]')
                    first?.focus()
                  }
                }}
                className="input"
                placeholder="Type to search or add a new tag…"
                autoComplete="off"
              />
              {tagSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {tagSuggestions.map((t, i) => (
                    <button
                      key={t}
                      data-suggestion
                      type="button"
                      onMouseDown={e => { e.preventDefault(); addTag(t) }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); addTag(t) }
                        if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLButtonElement)?.focus() }
                        if (e.key === 'ArrowUp') { e.preventDefault(); i === 0 ? tagRef.current?.querySelector('input')?.focus() : (e.currentTarget.previousElementSibling as HTMLButtonElement)?.focus() }
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" /> {t}
                    </button>
                  ))}
                  {tagInput.trim() && !allTags.map(t => t.toLowerCase()).includes(tagInput.trim().toLowerCase()) && (
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); addTag() }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 text-gray-500 border-t border-gray-100"
                    >
                      + Add "<span className="font-medium text-gray-800">{tagInput.trim()}</span>" as new tag
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={() => addTag()} className="px-3 sm:px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0">Add</button>
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recipe Copy</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={formatWithAI}
                disabled={aiFormatting || !form.recipe_copy.trim()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-40"
                title="Format with AI (requires OpenAI key from Import Docs)"
              >
                {aiFormatting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiFormatting ? 'Formatting…' : 'Format with AI'}
              </button>
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button type="button" onClick={() => setRecipeTab('write')} className={`px-3 py-1 text-xs rounded-md transition-colors ${recipeTab === 'write' ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Write</button>
                <button type="button" onClick={() => setRecipeTab('preview')} className={`px-3 py-1 text-xs rounded-md transition-colors ${recipeTab === 'preview' ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Preview</button>
              </div>
            </div>
          </div>
          {recipeTab === 'write' ? (
            <>
              <FormatToolbar textareaRef={copyRef} value={form.recipe_copy} onChange={v => set('recipe_copy', v)} />
              <textarea
                ref={copyRef}
                value={form.recipe_copy}
                onChange={e => set('recipe_copy', e.target.value)}
                className="input w-full font-mono text-sm leading-relaxed resize-y"
                style={{ minHeight: '360px' }}
                placeholder={"**Ingredients:**\n- \n\n**Method:**\n1. "}
              />
            </>
          ) : (
            <div className="min-h-[360px] bg-gray-50 rounded-xl p-4 sm:p-5 text-sm text-gray-700">
              {form.recipe_copy
                ? <MarkdownView content={form.recipe_copy} />
                : <p className="text-gray-400 italic">Nothing to preview yet.</p>
              }
            </div>
          )}
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

function FormatToolbar({ textareaRef, value, onChange }: {
  textareaRef: React.RefObject<HTMLTextAreaElement>
  value: string
  onChange: (v: string) => void
}) {
  function apply(type: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const sel = value.slice(start, end)
    let insert = ''

    switch (type) {
      case 'bold':
        insert = `**${sel || 'bold text'}**`
        break
      case 'heading':
        insert = (start > 0 && value[start - 1] !== '\n' ? '\n' : '') + `**${sel || 'Heading'}:**` + '\n'
        break
      case 'bullet': {
        const lines = sel ? sel.split('\n') : ['']
        insert = lines.map(l => `- ${l}`).join('\n')
        break
      }
      case 'numbered': {
        const lines = sel ? sel.split('\n') : ['']
        insert = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
        break
      }
      case 'divider':
        insert = '\n---\n'
        break
    }

    const newVal = value.slice(0, start) + insert + value.slice(end)
    onChange(newVal)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + insert.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 bg-gray-50 border border-gray-200 rounded-lg">
      <FmtBtn onClick={() => apply('bold')} title="Bold (wrap selection)"><Bold size={13} /></FmtBtn>
      <FmtBtn onClick={() => apply('heading')} title="Bold heading"><Heading2 size={13} /></FmtBtn>
      <span className="w-px h-4 bg-gray-200 mx-1" />
      <FmtBtn onClick={() => apply('bullet')} title="Bullet list"><List size={13} /></FmtBtn>
      <FmtBtn onClick={() => apply('numbered')} title="Numbered list"><ListOrdered size={13} /></FmtBtn>
      <span className="w-px h-4 bg-gray-200 mx-1" />
      <FmtBtn onClick={() => apply('divider')} title="Horizontal rule"><Minus size={13} /></FmtBtn>
      <span className="ml-auto text-[10px] text-gray-400 pr-1 hidden sm:block">Select text then click a button</span>
    </div>
  )
}

function FmtBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1.5 rounded hover:bg-white hover:shadow-sm text-gray-500 hover:text-gray-900 transition-colors"
    >
      {children}
    </button>
  )
}

function MarkdownView({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="text-lg font-bold mb-3 mt-5 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-4 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h3>,
        strong: ({ children }) => <strong className="font-bold text-gray-900">{children}</strong>,
        ul: ({ children }) => <ul className="list-disc list-outside ml-5 my-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-outside ml-5 my-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-gray-700 leading-snug">{children}</li>,
        p: ({ children }) => <p className="mb-2 leading-relaxed text-gray-700">{children}</p>,
        hr: () => <hr className="my-4 border-gray-200" />,
      }}
    >
      {preprocessToMarkdown(content)}
    </ReactMarkdown>
  )
}
