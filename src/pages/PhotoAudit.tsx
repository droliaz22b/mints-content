import { useState, useEffect, useCallback } from 'react'
import { pb } from '../lib/pocketbase'
import {
  supportsFolderPicker, pickRootFolder, getStoredRoot, clearRootFolder, listSubfolders,
} from '../lib/thumbnailFolder'
import {
  reconcile, auditToCsv, parseRange, STATUS_LABELS,
  type AuditResult, type AuditRecipe, type AuditStatus,
} from '../lib/thumbnailAudit'
import {
  Loader2, AlertCircle, FolderOpen, RefreshCw, Download, FolderSearch, CheckCircle2,
} from 'lucide-react'

type Phase = 'init' | 'need-folder' | 'loading' | 'ready' | 'error'

const STATUS_STYLE: Record<AuditStatus | 'orphan', string> = {
  ok: 'bg-green-50 text-green-700 border-green-200',
  name_mismatch: 'bg-amber-50 text-amber-700 border-amber-200',
  number_mismatch: 'bg-amber-50 text-amber-700 border-amber-200',
  ambiguous: 'bg-orange-50 text-orange-700 border-orange-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
  no_images: 'bg-red-50 text-red-700 border-red-200',
  missing: 'bg-gray-100 text-gray-600 border-gray-200',
  orphan: 'bg-purple-50 text-purple-700 border-purple-200',
}

// Order chips so the problems surface first; "OK" last.
const CHIP_ORDER: AuditStatus[] = ['conflict', 'no_images', 'missing', 'number_mismatch', 'name_mismatch', 'ambiguous', 'ok']

export default function PhotoAudit() {
  const [phase, setPhase] = useState<Phase>('init')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<AuditResult | null>(null)
  const [filter, setFilter] = useState<AuditStatus | 'orphan' | 'all'>('all')
  const [scope, setScope] = useState('') // human description of what was audited

  const run = useCallback(async (root: FileSystemDirectoryHandle) => {
    setPhase('loading'); setError(''); setFilter('all')
    try {
      setStatus('Loading recipes from the database…')
      const recipes = await pb.collection('recipes').getFullList<AuditRecipe>({
        fields: 'id,sl_no,recipe_name', sort: '+sl_no', batch: 500,
      })

      setStatus('Scanning image folders…')
      const folders = await listSubfolders(root)

      setStatus('Cross-tallying…')
      // Picked folder is a range like "401-600": audit only that slice of recipes.
      const range = parseRange(root.name)
      if (range) {
        const slice = recipes.filter(r => r.sl_no >= range.min && r.sl_no <= range.max)
        setScope(`Folder “${root.name}” · recipes ${range.min}–${range.max} (${slice.length} in database)`)
        setResult(reconcile(slice, folders, { includeMissing: true }))
      } else {
        setScope(`Folder “${root.name}” · no numeric range — matching folders to recipes by name only`)
        setResult(reconcile(recipes, folders, { includeMissing: false }))
      }
      setPhase('ready'); setStatus('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the audit.')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    (async () => {
      if (!supportsFolderPicker()) { setError('This feature needs Chrome or Edge (folder access).'); setPhase('error'); return }
      const root = await getStoredRoot()
      if (!root) { setPhase('need-folder'); return }
      await run(root)
    })()
  }, [run])

  async function chooseFolder() {
    try { await run(await pickRootFolder()) }
    catch (e) { if ((e as Error).name !== 'AbortError') { setError('Could not open the folder.'); setPhase('error') } }
  }

  async function changeFolder() { await clearRootFolder(); setResult(null); setError(''); setPhase('need-folder') }

  function downloadCsv() {
    if (!result) return
    const blob = new Blob([auditToCsv(result)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `photo-folder-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const c = result?.counts
  const problems = c ? c.total - c.ok + c.orphans : 0
  const showRows = !result ? []
    : filter === 'orphan' ? []
    : filter === 'all' ? result.rows
    : result.rows.filter(r => r.status === filter)
  const showOrphans = result && (filter === 'all' || filter === 'orphan') ? result.orphans : []

  return (
    <div className="w-full max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <FolderSearch size={20} className="text-amber-500" /> Photo Folder Audit
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Pick one range folder (e.g. “401-600”); it cross-tallies that slice of recipes against the folders inside and flags mismatches.</p>
        </div>
        {phase === 'ready' && (
          <div className="flex items-center gap-2">
            <button onClick={downloadCsv} className="inline-flex items-center gap-2 px-3.5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={() => getStoredRoot().then(r => r && run(r))} className="inline-flex items-center gap-2 px-3.5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
              <RefreshCw size={14} /> Re-scan
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {(phase === 'need-folder' || phase === 'error') && supportsFolderPicker() && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <FolderOpen size={28} className="mx-auto mb-3 text-gray-400" />
          <p className="text-sm text-gray-600 mb-1">Choose a range folder to audit.</p>
          <p className="text-xs text-gray-400 mb-4">Pick one numbered range (e.g. “401-600”) that holds one sub-folder per recipe.</p>
          <button onClick={chooseFolder} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800">
            <FolderOpen size={15} /> Select folder
          </button>
        </div>
      )}

      {(phase === 'init' || phase === 'loading') && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
          <Loader2 size={24} className="animate-spin mx-auto mb-3" />
          <p className="text-sm">{status || 'Loading…'}</p>
        </div>
      )}

      {phase === 'ready' && c && (
        <>
          {scope && <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5"><FolderOpen size={13} className="text-gray-400" /> {scope}</p>}
          {/* Summary banner */}
          <div className={`flex items-center gap-2 text-sm rounded-lg px-4 py-3 mb-4 border ${problems === 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
            {problems === 0
              ? <><CheckCircle2 size={15} /> All {c.total} recipes matched a folder cleanly. Nothing to fix.</>
              : <><AlertCircle size={15} /> {problems} item{problems !== 1 ? 's' : ''} need a look across {c.total} recipes and {c.orphans} orphan folder{c.orphans !== 1 ? 's' : ''}.</>}
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={c.total + c.orphans} />
            {CHIP_ORDER.map(s => c[s] > 0 && (
              <Chip key={s} active={filter === s} onClick={() => setFilter(s)} label={STATUS_LABELS[s]} count={c[s]} styleClass={STATUS_STYLE[s]} />
            ))}
            {c.orphans > 0 && (
              <Chip active={filter === 'orphan'} onClick={() => setFilter('orphan')} label="Orphan folders" count={c.orphans} styleClass={STATUS_STYLE.orphan} />
            )}
          </div>

          {/* Recipe rows */}
          {filter !== 'orphan' && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5 w-36">Status</th>
                    <th className="text-left font-medium px-4 py-2.5">Recipe</th>
                    <th className="text-left font-medium px-4 py-2.5">Matched folder</th>
                    <th className="text-right font-medium px-4 py-2.5 w-16">Imgs</th>
                    <th className="text-left font-medium px-4 py-2.5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {showRows.map(r => (
                    <tr key={r.recipe.id} className="align-top hover:bg-gray-50/60">
                      <td className="px-4 py-2.5"><span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[r.status]}`}>{STATUS_LABELS[r.status]}</span></td>
                      <td className="px-4 py-2.5"><span className="text-gray-400 font-mono text-xs mr-1.5">#{r.recipe.sl_no}</span>{r.recipe.recipe_name}</td>
                      <td className="px-4 py-2.5 text-gray-600">{r.folderName ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{r.folderName ? r.imageCount : ''}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{r.note}</td>
                    </tr>
                  ))}
                  {showRows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No recipes in this category.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Orphan folders */}
          {showOrphans.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
              <div className="px-4 py-2.5 bg-purple-50/60 border-b border-purple-100 text-xs font-semibold text-purple-700 uppercase tracking-wide">
                Orphan folders — not matched to any recipe ({showOrphans.length})
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Folder</th>
                    <th className="text-right font-medium px-4 py-2.5 w-16">Imgs</th>
                    <th className="text-left font-medium px-4 py-2.5">Closest recipe (unmatched)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {showOrphans.map(o => (
                    <tr key={o.name} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 text-gray-700">{o.name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{o.imageCount}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">
                        {o.guessRecipe
                          ? <>#{o.guessRecipe.sl_no} {o.guessRecipe.recipe_name} <span className="text-gray-300">(too weak to match)</span></>
                          : <span className="text-gray-300">No close recipe</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={changeFolder} className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
            <RefreshCw size={11} /> Change folder
          </button>
        </>
      )}
    </div>
  )
}

function Chip({ active, onClick, label, count, styleClass }: {
  active: boolean; onClick: () => void; label: string; count: number; styleClass?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active ? 'bg-black text-white border-black' : styleClass || 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
      }`}
    >
      {label} <span className={active ? 'opacity-80' : 'opacity-60'}>· {count}</span>
    </button>
  )
}
