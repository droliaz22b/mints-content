interface Props {
  tag: string
  onClick?: () => void
  active?: boolean
  size?: 'sm' | 'xs'
}

// A single, refined neutral pill — no per-tag colors. Keeps cards calm and
// premium-looking; the active state is a subtle dark fill rather than a ring.
export default function TagPill({ tag, onClick, active, size = 'sm' }: Props) {
  const base = size === 'xs' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-0.5'
  const tone = active
    ? 'bg-gray-900 text-white ring-1 ring-inset ring-gray-900'
    : 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-200'
  return (
    <span
      onClick={onClick}
      className={`inline-block rounded-full font-medium tracking-tight ${base} ${tone} ${onClick ? 'cursor-pointer hover:ring-gray-300 hover:text-gray-900 transition-colors' : ''}`}
    >
      {tag}
    </span>
  )
}
