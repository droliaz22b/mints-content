// File System Access API + IndexedDB helpers for the thumbnail generator.
// An admin picks their local OneDrive "thumbnail root" folder once (the handle is
// persisted in IndexedDB), then we navigate into the subfolder named by a recipe's
// sl_no and read the images. Reading image bytes auto-hydrates OneDrive
// "online-only" files on demand. Chrome/Edge only.

const DB_NAME = 'mints_thumbnails'
const STORE = 'handles'
const ROOT_KEY = 'thumb_root'
const IMAGE_RE = /\.(jpe?g|png|webp)$/i

type DirHandle = FileSystemDirectoryHandle

export interface FolderImage { name: string; file: File }

export function supportsFolderPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

// ── tiny IndexedDB key/value (handles are structured-cloneable) ───────────────
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const val = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
  db.close()
  return val
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

// ── folder handle lifecycle ───────────────────────────────────────────────────
export async function pickRootFolder(): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<DirHandle> }).showDirectoryPicker
  const handle = await picker({ mode: 'read' })
  await idbSet(ROOT_KEY, handle)
  return handle
}

export async function clearRootFolder(): Promise<void> {
  await idbDel(ROOT_KEY)
}

async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (o: object) => Promise<PermissionState>
    requestPermission?: (o: object) => Promise<PermissionState>
  }
  const opts = { mode: 'read' }
  if (h.queryPermission && (await h.queryPermission(opts)) === 'granted') return true
  if (h.requestPermission && (await h.requestPermission(opts)) === 'granted') return true
  return false
}

// Returns the stored root folder if we still hold read permission, else null.
export async function getStoredRoot(): Promise<DirHandle | null> {
  const handle = await idbGet<DirHandle>(ROOT_KEY)
  if (!handle) return null
  try {
    if (await ensurePermission(handle)) return handle
  } catch { /* permission denied or handle stale */ }
  return null
}

// ── navigating + reading ──────────────────────────────────────────────────────
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// Score how well a folder name matches a recipe. Name is prioritized over sl_no,
// but a matching number adds a strong boost (handles "1064 - Recipe Name" etc.).
function scoreFolder(folderName: string, slNo: number, recipeName: string): number {
  const nd = normalize(folderName)
  const nName = normalize(recipeName)
  const key = String(slNo)
  let score = 0

  if (nName) {
    if (nd === nName) score += 100
    else if (nd.includes(nName) && nName.length >= 4) score += 70
    else if (nName.includes(nd) && nd.length >= 4) score += 50
  }

  // sl_no as a standalone number anywhere in the name (not part of a bigger number)
  if (new RegExp(`(^|[^0-9])0*${key}([^0-9]|$)`).test(folderName)) score += 40
  if (folderName === key) score += 60

  return score
}

// Find the best-matching subfolder for a recipe, prioritizing the name and
// falling back to the sl_no. Returns null if nothing matches well enough.
export async function findRecipeFolder(root: DirHandle, slNo: number, recipeName: string): Promise<DirHandle | null> {
  const r = root as unknown as { values: () => AsyncIterable<FileSystemHandle> }
  let best: DirHandle | null = null
  let bestScore = 0
  for await (const entry of r.values()) {
    if (entry.kind !== 'directory') continue
    const score = scoreFolder(entry.name, slNo, recipeName)
    if (score > bestScore) { bestScore = score; best = entry as DirHandle }
  }
  return bestScore >= 40 ? best : null
}

// List image files in a folder (sorted naturally). getFile() is metadata-only;
// actual OneDrive hydration happens when the bytes are read (downscale/compose).
export async function listImages(dir: DirHandle): Promise<FolderImage[]> {
  const d = dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }
  const out: FolderImage[] = []
  for await (const entry of d.values()) {
    if (entry.kind === 'file' && IMAGE_RE.test(entry.name)) {
      out.push({ name: entry.name, file: await (entry as FileSystemFileHandle).getFile() })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return out
}

// Downscale to a small JPEG data URL — used for the grid + cheap AI vision input.
// Reading the bytes here triggers OneDrive download for online-only files.
export async function downscaleToDataUrl(file: File, max = 256): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.7)
}
