import { useState, useEffect, useRef, FormEvent } from 'react'
import { pb } from '../lib/pocketbase'
import { useSettings, type SiteSettings } from '../context/SettingsContext'
import { getAiKeyStatus, setAiKey } from '../lib/ai'
import { Save, Loader2, AlertCircle, CheckCircle2, Upload, X, KeyRound, Eye, EyeOff } from 'lucide-react'

function fileUrl(record: { collectionId: string; id: string }, name: string) {
  return name ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${name}` : ''
}

export default function SiteSettings() {
  const { settings, refresh } = useSettings()

  const [siteTitle, setSiteTitle] = useState('')
  const [tagline, setTagline] = useState('')
  const [description, setDescription] = useState('')

  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [faviconPreview, setFaviconPreview] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const faviconRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!settings) return
    setSiteTitle(settings.site_title || '')
    setTagline(settings.tagline || '')
    setDescription(settings.description || '')
    if (settings.favicon) setFaviconPreview(fileUrl(settings, settings.favicon))
    if (settings.logo) setLogoPreview(fileUrl(settings, settings.logo))
  }, [settings])

  function pickFile(file: File, type: 'favicon' | 'logo') {
    const url = URL.createObjectURL(file)
    if (type === 'favicon') { setFaviconFile(file); setFaviconPreview(url) }
    else { setLogoFile(file); setLogoPreview(url) }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      const data = new FormData()
      data.append('site_title', siteTitle)
      data.append('tagline', tagline)
      data.append('description', description)
      if (faviconFile) data.append('favicon', faviconFile)
      if (logoFile) data.append('logo', logoFile)

      if (settings?.id) {
        await pb.collection('site_settings').update(settings.id, data)
      } else {
        await pb.collection('site_settings').create(data)
      }
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Site Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage branding, title, and general site configuration.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-5">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Identity */}
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Site Identity</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Site Title</label>
            <input
              value={siteTitle}
              onChange={e => setSiteTitle(e.target.value)}
              className="input"
              placeholder="Mints CMS"
            />
            <p className="text-xs text-gray-400 mt-1">Shown in the browser tab and navigation header.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
            <input
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              className="input"
              placeholder="Facebook recipe video workspace"
            />
            <p className="text-xs text-gray-400 mt-1">Short description shown on the login page.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="A brief description of this CMS for meta tags…"
            />
          </div>
        </section>

        {/* Branding */}
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Branding</h2>

          {/* Favicon */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Favicon</label>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {faviconPreview
                  ? <img src={faviconPreview} alt="favicon" className="w-full h-full object-contain" />
                  : <span className="text-xs text-gray-400">none</span>
                }
              </div>
              <div className="space-y-1.5">
                <input ref={faviconRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && pickFile(e.target.files[0], 'favicon')} />
                <button type="button" onClick={() => faviconRef.current?.click()} className="flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
                  <Upload size={14} /> Upload new favicon
                </button>
                {faviconFile && (
                  <button type="button" onClick={() => { setFaviconFile(null); setFaviconPreview(settings?.favicon ? fileUrl(settings, settings.favicon) : '') }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                    <X size={12} /> Remove selection
                  </button>
                )}
                <p className="text-xs text-gray-400">PNG, ICO or SVG recommended. Shown in browser tab.</p>
              </div>
            </div>
          </div>

          {/* Logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-12 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoPreview
                  ? <img src={logoPreview} alt="logo" className="max-w-full max-h-full object-contain p-1" />
                  : <span className="text-xs text-gray-400">none</span>
                }
              </div>
              <div className="space-y-1.5">
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && pickFile(e.target.files[0], 'logo')} />
                <button type="button" onClick={() => logoRef.current?.click()} className="flex items-center gap-2 text-sm border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
                  <Upload size={14} /> Upload new logo
                </button>
                {logoFile && (
                  <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(settings?.logo ? fileUrl(settings, settings.logo) : '') }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                    <X size={12} /> Remove selection
                  </button>
                )}
                <p className="text-xs text-gray-400">Shown in the top-left navigation. PNG with transparent background works best.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle2 size={15} /> Saved successfully
            </span>
          )}
        </div>
      </form>

      <AiKeySection />
    </div>
  )
}

// ─── Shared OpenAI key (server-side; never sent to the browser) ───────────────
function AiKeySection() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAiKeyStatus().then(setConfigured).catch(() => setConfigured(false))
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) return
    setSaving(true); setError(''); setSaved(false)
    try {
      await setAiKey(key)
      setKeyInput('')
      setConfigured(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 mt-5">
      <div>
        <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
          <KeyRound size={13} /> OpenAI API Key
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Shared by everyone for AI formatting and tag suggestions. Stored securely on the server —
          team members never need their own key.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="text-sm">
        {configured === null ? (
          <span className="text-gray-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Checking…</span>
        ) : configured ? (
          <span className="flex items-center gap-1.5 text-green-700"><CheckCircle2 size={14} /> A key is configured.</span>
        ) : (
          <span className="flex items-center gap-1.5 text-amber-700"><AlertCircle size={14} /> No key set — AI features are disabled until you add one.</span>
        )}
      </div>

      <form onSubmit={save} className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {configured ? 'Replace key' : 'Set key'}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="sk-proj-…"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-gray-400">For security, the existing key is never displayed. Saving overwrites it.</p>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !keyInput.trim()}
            className="flex items-center gap-2 px-5 py-2.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Key'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle2 size={15} /> Key saved
            </span>
          )}
        </div>
      </form>
    </section>
  )
}
