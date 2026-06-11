import { createContext, useContext, useEffect, useState } from 'react'
import { pb } from '../lib/pocketbase'

export interface SiteSettings {
  id: string
  collectionId: string
  site_title: string
  tagline: string
  description: string
  favicon: string
  logo: string
}

interface SettingsContextType {
  settings: SiteSettings | null
  logoUrl: string
  faviconUrl: string
  refresh: () => Promise<void>
}

const Ctx = createContext<SettingsContextType>({
  settings: null, logoUrl: '', faviconUrl: '', refresh: async () => {},
})

function fileUrl(record: { collectionId: string; id: string }, name: string) {
  return name ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${name}` : ''
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings | null>(null)

  async function load() {
    try {
      const res = await pb.collection('site_settings').getList<SiteSettings>(1, 1)
      if (res.items.length > 0) setSettings(res.items[0])
    } catch { /* collection may not exist yet */ }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!settings) return
    if (settings.site_title) document.title = settings.site_title
    if (settings.favicon) {
      const url = fileUrl(settings, settings.favicon)
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
      link.href = url
    }
  }, [settings])

  const logoUrl = settings?.logo ? fileUrl(settings, settings.logo) : ''
  const faviconUrl = settings?.favicon ? fileUrl(settings, settings.favicon) : ''

  return (
    <Ctx.Provider value={{ settings, logoUrl, faviconUrl, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings() { return useContext(Ctx) }
