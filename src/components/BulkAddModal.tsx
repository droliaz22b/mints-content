import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { pb } from '../lib/pocketbase'
import type { RecipeStatus } from '../types'
import { X, Upload, AlertCircle, CheckCircle2, FileUp } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onDone: () => void
}

interface RawRow {
  sl_no?: unknown
  recipe_name?: unknown
  category?: unknown
  tags?: unknown
  instagram_format?: unknown
  instagram?: unknown
  youtube_format?: unknown
  youtube?: unknown
  fb_editor?: unknown
  fb?: unknown
  docs?: unknown
  thumbnails?: unknown
  website_draft?: unknown
  recipe_copy?: unknown
  status?: unknown
  platforms?: unknown
  date?: unknown
  editor?: unknown
}

const STATUSES: RecipeStatus[] = ['Draft', 'Ready', 'Edited', 'Posted', 'Uploaded', 'Done']

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
    else { cur += ch }
  }
  result.push(cur.trim())
  return result
}

export default function BulkAddModal({ open, onClose, onDone }: Props) {
  const [tab, setTab] = useState<'json' | 'csv'>('csv')
  const [input, setInput] = useState('')
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')

    const isXlsx = /\.(xlsx|xls)$/i.test(file.name)

    if (isXlsx) {
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const csv = XLSX.utils.sheet_to_csv(sheet)
          setInput(csv)
        } catch {
          setError('Failed to read Excel file. Make sure it is a valid .xlsx or .xls file.')
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = ev => setInput(ev.target?.result as string ?? '')
      reader.readAsText(file)
    }

    e.target.value = ''
  }

  if (!open) return null

  function parseInput(): RawRow[] {
    if (tab === 'json') {
      const parsed = JSON.parse(input)
      return Array.isArray(parsed) ? parsed : [parsed]
    }
    const lines = input.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) throw new Error('File must have a header row and at least one data row.')
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[\s.]/g, '_'))
    return lines.slice(1).map(line => {
      const vals = parseCSVLine(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = vals[i] || '' })
      return row as RawRow
    })
  }

  function normalizeRow(row: RawRow) {
    const slNo = Number(row.sl_no)
    if (!slNo || isNaN(slNo)) throw new Error(`Invalid sl_no: ${String(row.sl_no)}`)

    const rawTags = row.tags
    let tags: string[] = []
    if (Array.isArray(rawTags)) tags = rawTags.map(String)
    else if (typeof rawTags === 'string' && rawTags.trim()) tags = rawTags.split(/[,;]/).map(t => t.trim()).filter(Boolean)

    const rawPlatforms = row.platforms
    let platforms: string[] = []
    if (Array.isArray(rawPlatforms)) platforms = rawPlatforms.map(String)
    else if (typeof rawPlatforms === 'string' && rawPlatforms.trim()) platforms = rawPlatforms.split(/[,;]/).map(t => t.trim()).filter(Boolean)

    const status = STATUSES.includes(String(row.status) as RecipeStatus) ? String(row.status) as RecipeStatus : 'Draft'

    return {
      sl_no: slNo,
      recipe_name: String(row.recipe_name || '').trim(),
      category: String(row.category || '').trim(),
      tags,
      instagram_format: String(row.instagram_format || row['instagram'] || '').trim(),
      youtube_format: String(row.youtube_format || row['youtube'] || '').trim(),
      fb_editor: String(row.fb_editor || row['fb'] || '').trim(),
      docs: String(row.docs || '').trim(),
      thumbnails: String(row.thumbnails || '').trim(),
      website_draft: String(row.website_draft || '').trim(),
      recipe_copy: String(row.recipe_copy || '').trim(),
      status,
      platforms,
      date: String(row.date || '').trim(),
      editor: String(row.editor || '').trim(),
    }
  }

  async function handleImport() {
    setError(''); setDone(false); setProgress('')
    try {
      const rows = parseInput()
      let ok = 0; let fail = 0
      for (let i = 0; i < rows.length; i++) {
        setProgress(`Importing ${i + 1} / ${rows.length}…`)
        try {
          const data = normalizeRow(rows[i])
          if (!data.recipe_name) { fail++; continue }
          const existing = await pb.collection('recipes').getList(1, 1, { filter: `sl_no = ${data.sl_no}` })
          if (existing.items.length > 0) {
            await pb.collection('recipes').update(existing.items[0].id, data)
          } else {
            await pb.collection('recipes').create(data)
          }
          ok++
        } catch { fail++ }
      }
      setProgress('')
      setDone(true)
      setProgress(`Done — ${ok} imported, ${fail} skipped.`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse error. Check your data format.')
    }
  }

  function handleClose() {
    setInput(''); setFileName(''); setProgress(''); setDone(false); setError('')
    onClose()
  }

  const CSV_TEMPLATE = `sl_no,recipe_name,category,tags,instagram_format,youtube_format,fb_editor,docs,thumbnails,website_draft,recipe_copy,status,platforms
1,Instant Kurkure,Snacks,"Snacks,Crispy",Reels,Short,RKK,Done,Done,Done,Recipe text here,Draft,"Facebook,Instagram"`

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold">Bulk Add / Import</h2>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(['csv', 'json'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {tab === 'csv' && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="font-medium mb-1">Expected columns (header row required):</p>
              <code className="font-mono text-gray-600 break-all">{CSV_TEMPLATE.split('\n')[0]}</code>
              <p className="mt-2">• <strong>sl_no</strong> is the unique key — existing records with same sl_no will be updated.</p>
              <p>• Tags and platforms: comma-separated: <code>"Snacks,Crispy"</code></p>
            </div>
          )}

          {tab === 'json' && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="font-medium mb-1">Paste a JSON array of objects with fields matching the recipe schema.</p>
              <p>• <strong>sl_no</strong> is the unique key — existing records will be updated.</p>
            </div>
          )}

          {tab === 'csv' && (
            <div className="flex items-center gap-3 flex-wrap">
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={handleFile} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 text-sm border-2 border-dashed border-gray-300 rounded-xl hover:border-black hover:bg-gray-50 text-gray-600 transition-colors font-medium"
              >
                <FileUp size={16} /> Upload CSV or Excel file
              </button>
              {fileName && (
                <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <CheckCircle2 size={13} /> {fileName}
                </span>
              )}
            </div>
          )}

          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); if (e.target.value === '') setFileName('') }}
            rows={8}
            className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3 outline-none focus:ring-2 focus:ring-black resize-y"
            placeholder={tab === 'csv' ? CSV_TEMPLATE : '[{\n  "sl_no": 1,\n  "recipe_name": "Instant Kurkure",\n  ...\n}]'}
          />

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {progress && (
            <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg border ${done ? 'text-green-700 bg-green-50 border-green-200' : 'text-blue-700 bg-blue-50 border-blue-200'}`}>
              {done ? <CheckCircle2 size={15} /> : <Upload size={15} className="animate-pulse" />}
              {progress}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={handleClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!input.trim() || (!!progress && !done)}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            <Upload size={14} /> Import
          </button>
        </div>
      </div>
    </div>
  )
}
