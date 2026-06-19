import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { pb } from '../lib/pocketbase'
import { preprocessToMarkdown } from '../lib/formatRecipe'
import { generateCaption, type CaptionPlatform } from '../lib/caption'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import ThumbnailStudioModal from '../components/ThumbnailStudioModal'
import type { Recipe, RecipeStatus } from '../types'
import StatusBadge from '../components/StatusBadge'
import TagPill from '../components/TagPill'
import PlatformPill from '../components/PlatformPill'
import BulkAddModal from '../components/BulkAddModal'
import {
  Search, Plus, Upload, Download, LayoutGrid, Table2, Columns3,
  Pencil, Trash2, AlertCircle, SlidersHorizontal, X, ArrowUpToLine, ArrowUpDown, FileText,
  Copy, Check, Sparkles, Loader2,
} from 'lucide-react'

const SORT_OPTIONS = [
  { label: 'SL.No ↑',  value: '+sl_no' },
  { label: 'SL.No ↓',  value: '-sl_no' },
  { label: 'Name A-Z', value: '+recipe_name' },
  { label: 'Name Z-A', value: '-recipe_name' },
  { label: 'Latest',   value: '-created' },
]

const STATUSES: RecipeStatus[] = ['Draft', 'Ready', 'Edited', 'Posted', 'Uploaded', 'Done']
const PLATFORMS = ['Facebook', 'YouTube', 'Instagram']
const PER_PAGE = 24

const STATUS_STAT_COLORS: Record<RecipeStatus, string> = {
  Draft:    'text-gray-900',
  Ready:    'text-blue-600',
  Edited:   'text-amber-600',
  Posted:   'text-green-600',
  Uploaded: 'text-violet-600',
  Done:     'text-emerald-600',
}

type ViewMode = 'cards' | 'table' | 'kanban'

export default function Dashboard() {
  const navigate = useNavigate()

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<RecipeStatus | ''>('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterCategories, setFilterCategories] = useState<string[]>([])
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [sortBy, setSortBy] = useState('-sl_no')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [allTags, setAllTags] = useState<string[]>([])
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})

  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [previewRecipe, setPreviewRecipe] = useState<Recipe | null>(null)
  const [tagSearch, setTagSearch] = useState('')
  const [filterHasText, setFilterHasText] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [search])

  // Scroll-to-top visibility
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const hasMore = recipes.length < totalItems

  const fetchRecipes = useCallback(async () => {
    if (page === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const filters: string[] = []
      if (debouncedSearch) filters.push(`recipe_name ~ "${debouncedSearch}"`)
      if (filterStatus) filters.push(`status = "${filterStatus}"`)
      if (filterPlatform) filters.push(`platforms ~ "${filterPlatform}"`)
      if (filterCategories.length > 0) filters.push(`(${filterCategories.map(c => `category = "${c}"`).join(' || ')})`)
      if (filterTags.length > 0) filters.push(`(${filterTags.map(t => `tags ~ "${t}"`).join(' || ')})`)
      if (filterHasText) filters.push(`recipe_copy != ""`)

      const result = await pb.collection('recipes').getList<Recipe>(page, PER_PAGE, {
        filter: filters.join(' && '),
        sort: sortBy,
      })
      setRecipes(prev => page === 1 ? result.items : [...prev, ...result.items])
      setTotalItems(result.totalItems)
    } catch {
      setError('Failed to load recipes.')
    } finally {
      if (page === 1) setLoading(false)
      else setLoadingMore(false)
    }
  }, [page, debouncedSearch, filterStatus, filterPlatform, filterCategories, filterTags, sortBy, filterHasText])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && !loadingMore && hasMore) {
        setPage(p => p + 1)
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading, loadingMore, hasMore])

  useEffect(() => { fetchRecipes() }, [fetchRecipes])

  useEffect(() => {
    async function loadMeta() {
      try {
        const [tagsRes, catsRes] = await Promise.all([
          pb.collection('tags').getFullList({ sort: 'name' }),
          pb.collection('categories').getFullList({ sort: 'name' }),
        ])
        setAllTags(tagsRes.map(t => t.name as string))
        setAllCategories(catsRes.map(c => c.name as string))
      } catch { /* non-critical */ }

      try {
        const counts: Record<string, number> = {}
        await Promise.all(
          STATUSES.map(async s => {
            const r = await pb.collection('recipes').getList(1, 1, { filter: `status = "${s}"` })
            counts[s] = r.totalItems
          })
        )
        const total = await pb.collection('recipes').getList(1, 1, {})
        counts['Total'] = total.totalItems
        setStatusCounts(counts)
      } catch { /* non-critical */ }
    }
    loadMeta()
  }, [recipes])

  async function deleteRecipe(id: string) {
    try {
      await pb.collection('recipes').delete(id)
      setDeleteConfirmId(null)
      fetchRecipes()
    } catch {
      alert('Failed to delete recipe.')
    }
  }

  async function bulkDelete() {
    for (const id of selected) {
      await pb.collection('recipes').delete(id)
    }
    setSelected(new Set())
    fetchRecipes()
  }

  async function bulkUpdateStatus(status: RecipeStatus) {
    for (const id of selected) {
      await pb.collection('recipes').update(id, { status })
    }
    setSelected(new Set())
    fetchRecipes()
  }

  function exportCSV() {
    const header = ['SL.No','Recipe Name','Category','Tags','Instagram','YouTube','FB','Docs','Thumbnails','Website Draft','Recipe Copy','Status','Platforms']
    const rows = recipes.map(r => [
      r.sl_no, r.recipe_name, r.category,
      (r.tags || []).join('; '),
      r.instagram_format, r.youtube_format, r.fb_editor,
      r.docs, r.thumbnails, r.website_draft,
      r.recipe_copy, r.status,
      (r.platforms || []).join('; '),
    ])
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'recipes.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === recipes.length) setSelected(new Set())
    else setSelected(new Set(recipes.map(r => r.id)))
  }


  return (
    <div>
      {/* Compact page header */}
      <div className="flex items-center justify-between mb-2 sm:mb-4">
        <h1 className="text-base sm:text-xl font-bold tracking-tight">Content Library</h1>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-2 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {totalItems.toLocaleString()}
          </span>
          <button onClick={exportCSV} title="Export CSV" className="p-2 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 text-gray-600">
            <Download size={15} />
          </button>
          <button onClick={() => setBulkOpen(true)} title="Bulk Import" className="p-2 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 text-gray-600">
            <Upload size={15} />
          </button>
          <button onClick={() => navigate('/recipe/new')} className="flex items-center gap-1 text-sm bg-black text-white rounded-lg px-3 py-1.5 hover:bg-gray-800 font-medium">
            <Plus size={14} /> New
          </button>
        </div>
      </div>

      {/* Status stats — horizontal scroll on mobile */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-7 sm:gap-3 mb-3 sm:mb-5 scrollbar-none">
        {(['Total', ...STATUSES] as const).map(s => {
          const count = statusCounts[s] ?? 0
          const total = statusCounts['Total'] || 1
          const pct = s === 'Total' ? null : Math.round((count / total) * 100)
          return (
            <div
              key={s}
              onClick={() => s !== 'Total' && setFilterStatus(filterStatus === s ? '' : s as RecipeStatus)}
              className={`flex-shrink-0 bg-white border rounded-xl px-3 py-2 sm:p-4 min-w-[78px] sm:min-w-0 ${s !== 'Total' ? 'cursor-pointer hover:border-gray-400 transition-colors' : ''} ${filterStatus === s ? 'border-black ring-1 ring-black' : 'border-gray-200'}`}
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 truncate">{s}</p>
              <p className={`text-xl sm:text-2xl font-bold leading-none ${s !== 'Total' ? STATUS_STAT_COLORS[s as RecipeStatus] : 'text-gray-900'}`}>{count.toLocaleString()}</p>
              {pct !== null && <p className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">{pct}%</p>}
            </div>
          )
        })}
      </div>

      {/* Sticky search bar */}
      <div className="sticky top-14 z-20 bg-gray-50 py-2 -mx-3 px-3 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search recipes…"
              className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-black focus:border-transparent shadow-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltersOpen(v => !v)}
            className={`flex-shrink-0 flex items-center gap-1 text-sm border rounded-lg px-2.5 py-2 sm:hidden transition-colors ${filtersOpen ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600 shadow-sm'}`}
          >
            <SlidersHorizontal size={14} />
          </button>
          {/* Desktop filters + sort inline */}
          <div className="hidden sm:flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value as RecipeStatus | ''); setPage(1) }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none cursor-pointer shadow-sm"
            >
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterPlatform}
              onChange={e => { setFilterPlatform(e.target.value); setPage(1) }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none cursor-pointer shadow-sm"
            >
              <option value="">All platforms</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 bg-white shadow-sm">
              <ArrowUpDown size={13} className="text-gray-400 flex-shrink-0" />
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); setPage(1) }}
                className="text-sm bg-transparent outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button
              onClick={() => { setFilterHasText(v => !v); setPage(1) }}
              className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 transition-colors shadow-sm ${filterHasText ? 'bg-green-600 text-white border-green-600' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}
              title="Show only recipes with recipe text"
            >
              <FileText size={13} /> Has text
            </button>
          </div>
        </div>

        {/* Mobile filter panel */}
        {filtersOpen && (
          <div className="sm:hidden grid grid-cols-2 gap-2 mt-2">
            <select
              value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value as RecipeStatus | ''); setPage(1) }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
            >
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterPlatform}
              onChange={e => { setFilterPlatform(e.target.value); setPage(1) }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
            >
              <option value="">All platforms</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={e => { setSortBy(e.target.value); setPage(1) }}
              className="col-span-2 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={() => { setFilterHasText(v => !v); setPage(1) }}
              className={`col-span-2 flex items-center justify-center gap-2 text-sm border rounded-lg px-3 py-2 transition-colors ${filterHasText ? 'bg-green-600 text-white border-green-600' : 'bg-white border-gray-200 text-gray-600'}`}
            >
              <FileText size={13} /> {filterHasText ? 'Showing: has recipe text ✓' : 'Show only recipes with text'}
            </button>
          </div>
        )}
      </div>

      {/* Tag + Category filter chips */}
      {(allTags.length > 0 || allCategories.length > 0) && (
        <div className="space-y-1.5 mb-4">
          {allTags.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 -mx-3 px-3 sm:-mx-6 sm:px-6">
                <span className="flex-shrink-0 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-16 sm:w-20">Tags</span>
                <div className="relative flex-shrink-0">
                  <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                    placeholder="filter…"
                    className="pl-5 pr-2 py-0.5 text-xs border border-gray-200 rounded-md bg-white outline-none focus:ring-1 focus:ring-black w-24 sm:w-32"
                  />
                  {tagSearch && (
                    <button onClick={() => setTagSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={10} />
                    </button>
                  )}
                </div>
                {filterTags.length > 0 && (
                  <button onClick={() => { setFilterTags([]); setPage(1) }} className="text-[10px] text-gray-400 hover:text-gray-700 flex-shrink-0">
                    clear ({filterTags.length})
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:-mx-6 sm:px-6 pb-0.5">
                {allTags
                  .filter(t => !tagSearch || t.toLowerCase().includes(tagSearch.toLowerCase()))
                  .map(t => (
                    <button
                      key={t}
                      onClick={() => { setFilterTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); setPage(1) }}
                      className={`flex-shrink-0 text-xs px-2.5 py-0.5 rounded-full border font-medium transition-colors whitespace-nowrap ${filterTags.includes(t) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'}`}
                    >
                      {t}
                    </button>
                  ))
                }
                {tagSearch && allTags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase())).length === 0 && (
                  <span className="text-xs text-gray-400 py-0.5">No tags match "{tagSearch}"</span>
                )}
              </div>
            </div>
          )}
          {allCategories.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 sm:-mx-6 sm:px-6">
              <span className="flex-shrink-0 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-16 sm:w-20">Categories</span>
              <div className="flex gap-1.5 py-0.5">
                {allCategories.map(c => (
                  <button
                    key={c}
                    onClick={() => { setFilterCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]); setPage(1) }}
                    className={`flex-shrink-0 text-xs px-2.5 py-0.5 rounded-full border font-medium transition-colors whitespace-nowrap ${filterCategories.includes(c) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* View switcher + bulk actions */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
          {([['cards', LayoutGrid], ['table', Table2], ['kanban', Columns3]] as const).map(([mode, Icon]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-sm transition-colors ${viewMode === mode ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Icon size={14} /> <span className="hidden sm:inline">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600">{selected.size} sel.</span>
              <select
                onChange={e => { if (e.target.value) bulkUpdateStatus(e.target.value as RecipeStatus) }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                defaultValue=""
              >
                <option value="" disabled>Status…</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={bulkDelete} className="text-sm text-red-600 hover:text-red-700 px-2 py-1">Delete</button>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === recipes.length}
              onChange={toggleSelectAll}
              className="rounded"
            />
            <span className="hidden sm:inline">Select All</span>
          </label>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && recipes.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base font-medium">No recipes found</p>
          <p className="text-sm mt-1">Try adjusting your filters or add a new recipe.</p>
        </div>
      )}

      {/* Content views */}
      {!loading && recipes.length > 0 && (
        <>
          {viewMode === 'cards' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {recipes.map(r => (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  selected={selected.has(r.id)}
                  onSelect={() => toggleSelect(r.id)}
                  onPreview={() => setPreviewRecipe(r)}
                  onEdit={() => navigate(`/recipe/${r.id}/edit`)}
                  onDelete={() => setDeleteConfirmId(r.id)}
                />
              ))}
            </div>
          )}

          {viewMode === 'table' && (
            <RecipeTable
              recipes={recipes}
              selected={selected}
              onSelect={toggleSelect}
              onPreview={r => setPreviewRecipe(r)}
              onEdit={id => navigate(`/recipe/${id}/edit`)}
              onDelete={id => setDeleteConfirmId(id)}
            />
          )}

          {viewMode === 'kanban' && (
            <KanbanView
              recipes={recipes}
              onPreview={r => setPreviewRecipe(r)}
              onEdit={id => navigate(`/recipe/${id}/edit`)}
            />
          )}
        </>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {loadingMore && (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
        </div>
      )}
      {!hasMore && recipes.length > 0 && !loading && (
        <p className="text-center text-xs text-gray-400 py-6">All {totalItems.toLocaleString()} recipes loaded</p>
      )}

      {/* Scroll to top */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 w-10 h-10 bg-black text-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-800 transition-all"
        >
          <ArrowUpToLine size={16} />
        </button>
      )}

      {/* Delete confirm */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl p-6 w-full sm:w-80 shadow-xl">
            <h3 className="font-semibold mb-2">Delete recipe?</h3>
            <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirmId(null)} className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => deleteRecipe(deleteConfirmId)} className="text-sm px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      <BulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={fetchRecipes} />

      {previewRecipe && (
        <RecipePreviewModal
          recipe={previewRecipe}
          onClose={() => setPreviewRecipe(null)}
          onEdit={() => { navigate(`/recipe/${previewRecipe.id}/edit`); setPreviewRecipe(null) }}
        />
      )}
    </div>
  )
}

// ---- Recipe Card ----
function RecipeCard({ recipe: r, selected, onSelect, onPreview, onEdit, onDelete }: {
  recipe: Recipe; selected: boolean; onSelect: () => void; onPreview: () => void; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div
      onClick={onPreview}
      className={`bg-white border rounded-xl p-3 sm:p-4 flex flex-col gap-2.5 group relative cursor-pointer hover:border-gray-400 transition-colors ${selected ? 'border-black ring-1 ring-black' : 'border-gray-200'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            onClick={e => e.stopPropagation()}
            className="rounded mt-0.5"
          />
          <span className="text-xs text-gray-400 font-medium">#{r.sl_no}</span>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <h3 className="font-semibold text-sm leading-snug line-clamp-2">{r.recipe_name}</h3>
      {(r.tags?.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {r.tags.slice(0, 3).map(t => <TagPill key={t} tag={t} size="xs" />)}
        </div>
      )}
      {(r.platforms?.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {r.platforms.map(p => <PlatformPill key={p} platform={p} />)}
        </div>
      )}
      <div className="flex items-center justify-between mt-auto pt-1">
        {r.recipe_copy
          ? <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium"><FileText size={9} /> Recipe text ✓</span>
          : <span className="text-[10px] text-gray-300">No recipe text</span>
        }
        <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); onEdit() }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"><Pencil size={13} /></button>
          <button onClick={e => { e.stopPropagation(); onDelete() }} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}

// ---- Table View ----
function RecipeTable({ recipes, selected, onSelect, onPreview, onEdit, onDelete }: {
  recipes: Recipe[]; selected: Set<string>; onSelect: (id: string) => void; onPreview: (r: Recipe) => void; onEdit: (id: string) => void; onDelete: (id: string) => void
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-3 sm:px-4 py-3 text-left w-8"><input type="checkbox" className="rounded" /></th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">SL</th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Recipe</th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Category</th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Tags</th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Platforms</th>
              <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-3 sm:px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => onPreview(r)}
                className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}
              >
                <td className="px-3 sm:px-4 py-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => onSelect(r.id)} className="rounded" />
                </td>
                <td className="px-3 sm:px-4 py-3 text-gray-400 font-mono text-xs">{r.sl_no}</td>
                <td className="px-3 sm:px-4 py-3 font-medium max-w-[160px] sm:max-w-xs truncate">{r.recipe_name}</td>
                <td className="px-3 sm:px-4 py-3 text-gray-500 hidden md:table-cell">{r.category}</td>
                <td className="px-3 sm:px-4 py-3 hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(r.tags || []).slice(0, 3).map(t => <TagPill key={t} tag={t} size="xs" />)}
                  </div>
                </td>
                <td className="px-3 sm:px-4 py-3 hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(r.platforms || []).map(p => <PlatformPill key={p} platform={p} />)}
                  </div>
                </td>
                <td className="px-3 sm:px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-3 sm:px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <button onClick={() => onEdit(r.id)} className="p-1 rounded hover:bg-gray-200 text-gray-400"><Pencil size={13} /></button>
                    <button onClick={() => onDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- Kanban View ----
function KanbanView({ recipes, onPreview, onEdit }: { recipes: Recipe[]; onPreview: (r: Recipe) => void; onEdit: (id: string) => void }) {
  const byStatus = STATUSES.reduce<Record<string, Recipe[]>>((acc, s) => {
    acc[s] = recipes.filter(r => r.status === s)
    return acc
  }, {})

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-3 sm:mx-0 px-3 sm:px-0">
      {STATUSES.map(s => (
        <div key={s} className="flex-shrink-0 w-56 sm:w-64">
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <StatusBadge status={s} />
            <span className="text-xs text-gray-400 font-medium">{byStatus[s].length}</span>
          </div>
          <div className="space-y-2">
            {byStatus[s].map(r => (
              <div
                key={r.id}
                onClick={() => onPreview(r)}
                className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-gray-400 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400">#{r.sl_no}</p>
                  <button
                    onClick={e => { e.stopPropagation(); onEdit(r.id) }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-100 text-gray-400"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
                <p className="text-sm font-medium line-clamp-2">{r.recipe_name}</p>
                {(r.tags?.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {r.tags.slice(0, 2).map(t => <TagPill key={t} tag={t} size="xs" />)}
                  </div>
                )}
              </div>
            ))}
            {byStatus[s].length === 0 && (
              <div className="border-2 border-dashed border-gray-100 rounded-lg p-4 text-center text-xs text-gray-300">Empty</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Recipe Preview Modal ----
function RecipePreviewModal({ recipe: r, onClose, onEdit }: { recipe: Recipe; onClose: () => void; onEdit: () => void }) {
  const { isAdmin } = useAuth()
  const [showThumb, setShowThumb] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-5 sm:p-6 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-400 font-mono">#{r.sl_no}</span>
              <StatusBadge status={r.status} />
              {r.category && <span className="text-xs text-gray-400">{r.category}</span>}
            </div>
            <h2 className="text-lg font-bold leading-snug">{r.recipe_name}</h2>
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>

        {/* Tags + platforms */}
        {((r.tags?.length > 0) || (r.platforms?.length > 0)) && (
          <div className="px-5 sm:px-6 py-3 border-b border-gray-100 flex flex-wrap gap-1.5">
            {(r.tags || []).map(t => <TagPill key={t} tag={t} size="xs" />)}
            {(r.platforms || []).map(p => <PlatformPill key={p} platform={p} />)}
          </div>
        )}

        {/* Recipe text + caption generator */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          <RecipeBody markdown={r.recipe_copy ? preprocessToMarkdown(r.recipe_copy) : ''} />
          <div className="border-t border-gray-100 pt-5">
            <CaptionGenerator recipeName={r.recipe_name} platforms={r.platforms} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 sm:px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
          {isAdmin && (
            <button
              onClick={() => setShowThumb(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Sparkles size={13} /> Make Thumbnail
            </button>
          )}
          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800"
          >
            <Pencil size={13} /> Edit Recipe
          </button>
        </div>
      </div>

      {showThumb && <ThumbnailStudioModal recipe={r} onClose={() => setShowThumb(false)} />}
    </div>
  )
}

// ---- Recipe body: rendered markdown with a single "Copy recipe" button ----
const MD_COMPONENTS = {
  h1: ({ children }: { children?: ReactNode }) => <h1 className="text-lg font-bold mb-3 mt-5 first:mt-0 text-gray-900">{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className="text-base font-bold mb-2 mt-4 first:mt-0 text-gray-900">{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className="text-sm font-bold mb-2 mt-4 first:mt-0 text-gray-900">{children}</h3>,
  strong: ({ children }: { children?: ReactNode }) => <strong className="font-bold text-gray-900">{children}</strong>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc list-outside ml-5 my-3 space-y-1.5">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal list-outside ml-5 my-3 space-y-1.5">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="text-gray-700 text-sm leading-relaxed">{children}</li>,
  p: ({ children }: { children?: ReactNode }) => <p className="text-sm text-gray-700 mb-3 leading-relaxed">{children}</p>,
  hr: () => <hr className="my-4 border-gray-200" />,
}

// Markdown → clean plain text for clipboard (bullets to •, strip bold, keep numbering).
function toPlainText(md: string): string {
  return md.split('\n')
    .map(l => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[-*+]\s+/, '• ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 flex-shrink-0"
    >
      {copied
        ? <><Check size={12} className="text-green-600" /> Copied</>
        : <><Copy size={12} /> {label}</>}
    </button>
  )
}

function RecipeBody({ markdown }: { markdown: string }) {
  if (!markdown) return <p className="text-sm text-gray-400 italic">No recipe text added yet.</p>

  return (
    <div>
      <div className="flex justify-end mb-2">
        <CopyButton text={toPlainText(markdown)} label="Copy recipe" />
      </div>
      <ReactMarkdown components={MD_COMPONENTS}>{markdown}</ReactMarkdown>
    </div>
  )
}

// ---- Social caption generator (uses the shared OpenAI proxy) ----
const CAPTION_PLATFORMS: CaptionPlatform[] = ['Facebook', 'Instagram']

function CaptionGenerator({ recipeName, platforms }: { recipeName: string; platforms?: string[] }) {
  const { settings } = useSettings()
  const preferred = CAPTION_PLATFORMS.find(p => platforms?.includes(p)) || 'Facebook'
  const [platform, setPlatform] = useState<CaptionPlatform>(preferred)
  const [caption, setCaption] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setLoading(true); setError('')
    try {
      setCaption(await generateCaption(recipeName, platform, settings?.caption_prompt))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate caption.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
          <Sparkles size={15} className="text-amber-500" /> Social Caption
        </h3>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {CAPTION_PLATFORMS.map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                platform === p ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {caption ? (
        <div>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={10}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-black focus:border-transparent resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <CopyButton text={caption} label="Copy caption" />
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {loading ? 'Generating…' : 'Regenerate'}
            </button>
            <span className="text-xs text-gray-400 ml-auto">Edit before posting if you like.</span>
          </div>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? 'Generating caption…' : `Generate ${platform} caption`}
        </button>
      )}
    </div>
  )
}
