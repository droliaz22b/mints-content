import type { RecipeStatus } from '../types'

const CONFIG: Record<RecipeStatus, { bg: string; text: string }> = {
  Draft:    { bg: 'bg-gray-900',   text: 'text-white' },
  Ready:    { bg: 'bg-blue-600',   text: 'text-white' },
  Edited:   { bg: 'bg-amber-500',  text: 'text-white' },
  Posted:   { bg: 'bg-green-600',  text: 'text-white' },
  Uploaded: { bg: 'bg-violet-600', text: 'text-white' },
  Done:     { bg: 'bg-emerald-500',text: 'text-white' },
}

export default function StatusBadge({ status }: { status: RecipeStatus }) {
  const c = CONFIG[status] ?? CONFIG.Draft
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
      {status}
    </span>
  )
}
