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
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export type NameMatch = 'exact' | 'partial' | 'none'

export interface MatchComponents {
  score: number
  nameScore: number
  numberScore: number
  name: NameMatch
  number: boolean
}

// Break down how well a folder name matches a recipe into name vs number signals.
// Name is prioritized; a matching sl_no adds a strong boost ("1064 - Recipe Name").
export function matchComponents(folderName: string, slNo: number, recipeName: string): MatchComponents {
  const nd = normalize(folderName)
  const nName = normalize(recipeName)
  const key = String(slNo)

  let nameScore = 0
  let name: NameMatch = 'none'
  if (nName) {
    if (nd === nName) { nameScore = 100; name = 'exact' }
    else if (nd.includes(nName) && nName.length >= 4) { nameScore = 70; name = 'partial' }
    else if (nName.includes(nd) && nd.length >= 4) { nameScore = 50; name = 'partial' }
  }

  let numberScore = 0
  // sl_no as a standalone number anywhere in the name (not part of a bigger number)
  if (new RegExp(`(^|[^0-9])0*${key}([^0-9]|$)`).test(folderName)) numberScore += 40
  if (folderName === key) numberScore += 60

  return { score: nameScore + numberScore, nameScore, numberScore, name, number: numberScore > 0 }
}

// Score how well a folder name matches a recipe (name prioritized over sl_no).
function scoreFolder(folderName: string, slNo: number, recipeName: string): number {
  return matchComponents(folderName, slNo, recipeName).score
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

// Photos sometimes sit directly in the recipe folder and sometimes inside a
// nested sub-folder, so we walk a few levels deep when collecting/counting.
const MAX_IMAGE_DEPTH = 4

interface DirLike { values: () => AsyncIterable<FileSystemHandle> }

// Recursively gather image files (depth-limited). Nested files are prefixed with
// their sub-folder path so names stay unique and sort sensibly.
async function gatherImages(dir: DirLike, prefix = '', depth = 0): Promise<FolderImage[]> {
  const out: FolderImage[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && IMAGE_RE.test(entry.name)) {
      out.push({ name: prefix + entry.name, file: await (entry as FileSystemFileHandle).getFile() })
    } else if (entry.kind === 'directory' && depth < MAX_IMAGE_DEPTH) {
      out.push(...await gatherImages(entry as unknown as DirLike, `${prefix}${entry.name}/`, depth + 1))
    }
  }
  return out
}

async function countImages(dir: DirLike, depth = 0): Promise<number> {
  let n = 0
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && IMAGE_RE.test(entry.name)) n++
    else if (entry.kind === 'directory' && depth < MAX_IMAGE_DEPTH) n += await countImages(entry as unknown as DirLike, depth + 1)
  }
  return n
}

// List image files in a folder, including any in nested sub-folders (sorted
// naturally). getFile() is metadata-only; cloud hydration happens when the
// bytes are read (downscale/compose).
export async function listImages(dir: DirHandle): Promise<FolderImage[]> {
  const out = await gatherImages(dir as unknown as DirLike)
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return out
}

export interface SubFolder { name: string; imageCount: number }

// Enumerate the root's immediate sub-folders with how many images each contains
// (counting nested sub-folders too). Used by the Photo Audit.
export async function listSubfolders(root: DirHandle): Promise<SubFolder[]> {
  const r = root as unknown as DirLike
  const out: SubFolder[] = []
  for await (const entry of r.values()) {
    if (entry.kind !== 'directory') continue
    const imageCount = await countImages(entry as unknown as DirLike)
    out.push({ name: entry.name, imageCount })
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
