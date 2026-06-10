const PALETTE = [
  'bg-pink-100 text-pink-700',
  'bg-purple-100 text-purple-700',
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-amber-100 text-amber-700',
  'bg-red-100 text-red-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-indigo-100 text-indigo-700',
  'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-700',
  'bg-rose-100 text-rose-700',
]

function colorForTag(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0xffff
  return PALETTE[hash % PALETTE.length]
}

interface Props {
  tag: string
  onClick?: () => void
  active?: boolean
  size?: 'sm' | 'xs'
}

export default function TagPill({ tag, onClick, active, size = 'sm' }: Props) {
  const color = colorForTag(tag)
  const base = size === 'xs' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
  return (
    <span
      onClick={onClick}
      className={`inline-block rounded-full font-medium ${base} ${color} ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${active ? 'ring-2 ring-offset-1 ring-current' : ''}`}
    >
      {tag}
    </span>
  )
}
