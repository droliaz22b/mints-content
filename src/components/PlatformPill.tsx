const COLORS: Record<string, string> = {
  Facebook:  'bg-blue-50 text-blue-700 border-blue-200',
  YouTube:   'bg-red-50 text-red-700 border-red-200',
  Instagram: 'bg-pink-50 text-pink-700 border-pink-200',
}

export default function PlatformPill({ platform }: { platform: string }) {
  const c = COLORS[platform] ?? 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${c}`}>
      {platform}
    </span>
  )
}
