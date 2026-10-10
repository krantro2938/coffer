/**
 * Folder sharing. A folder link shares an encrypted manifest (a "bundle" item)
 * listing a snapshot of the folder's files together with their file keys. The
 * server only learns which item ids the link may serve — never names or keys.
 *
 * The server cannot write a manifest, so a link follows its folder only as far
 * as its owner's browser carries it: whenever the drive is open here and a
 * shared folder no longer matches its manifest, a new one is uploaded and the
 * link is pointed at it (syncFolderLinks).
 */
import { Zip, ZipPassThrough } from "fflate"
import { api } from "./api"
import { b32decode, CHUNK_SIZE, fromB64, openShareWrap, sha256, shareKeys, toB64, wrapForShare } from "./crypto"
import type { DFolder, DItem, Drive, DShare } from "./drive"
import { linkRequest, type LinkUpload } from "./requests"
import { createShare, downloadDecrypted, safeFileName, safePath, storeItem, type CreatedShare, type ShareOptions } from "./transfer"
import { t } from "./i18n"

export const BUNDLE_TYPE = "application/x-coffer-bundle"

export type BundleFile = {
  id: string
  path: string // relative to the shared folder, e.g. "photos/2024/beach.jpg"
  name: string
  type: string
  size: number
  key: string // base64 file key
  chunkSize: number
  chunkCount: number
  cipherSize: number
}

export type Manifest = {
  v: 1
  name: string
  createdAt: number
  files: BundleFile[]
  /** Present when the link's holders may add files to the folder. */
  upload?: LinkUpload
}

/** Every readable file below `folder`, with paths relative to it. */
export function collectFolder(drive: Drive, folder: DFolder): BundleFile[] {
  const children = new Map<string, DFolder[]>()
  for (const f of drive.folders) if (f.parentId) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f])
  const prefix = new Map<string, string>([[folder.id, ""]])
  const queue = [folder.id]
  while (queue.length) {
    const id = queue.shift()!
    for (const c of children.get(id) ?? []) {
      prefix.set(c.id, `${prefix.get(id)}${c.name}/`)
      queue.push(c.id)
    }
  }
  return drive.items
    .filter((i) => i.kind !== "bundle" && !i.broken && i.folderId && prefix.has(i.folderId))
    .map((i) => ({
      id: i.id,
      path: `${prefix.get(i.folderId!)}${i.kind === "text" && !/\.\w+$/.test(i.name) ? `${i.name}.txt` : i.name}`,
      name: i.name,
      type: i.type,
      size: i.size,
      key: toB64(i.fileKey!),
      chunkSize: i.row.chunkSize,
      chunkCount: i.row.chunkCount,
      cipherSize: i.row.size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Identifies what a manifest shows, so a stale one can be told from a current one without downloading it. */
async function manifestDigest(name: string, files: BundleFile[]): Promise<string> {
  const shown = JSON.stringify([name, files.map((f) => [f.id, f.path, f.size])])
  return toB64(await sha256(new TextEncoder().encode(shown)))
}

async function storeManifest(folder: DFolder, files: BundleFile[], masterKey: CryptoKey, upload?: LinkUpload) {
  const manifest: Manifest = { v: 1, name: folder.name, createdAt: Math.floor(Date.now() / 1000), files }
  if (upload) manifest.upload = upload
  return storeItem({
    kind: "bundle",
    name: folder.name,
    type: BUNDLE_TYPE,
    blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
    masterKey,
    metaFolderId: folder.id,
    digest: await manifestDigest(folder.name, files),
  })
}

/**
 * Shares a folder. With `canAdd`, whoever holds the link may also upload into
 * the folder: the manifest then carries what an upload needs, and a file
 * request behind the link admits and encrypts those uploads for the owner.
 */
export async function shareFolder(
  drive: Drive,
  folder: DFolder,
  opts: ShareOptions,
  masterKey: CryptoKey,
  canAdd = false
): Promise<CreatedShare> {
  const files = collectFolder(drive, folder)
  if (files.length === 0 && !canAdd) throw new Error(t("This folder has no files to share yet"))
  const request = canAdd ? await linkRequest(masterKey, folder.id, folder.name) : null
  const stored = await storeManifest(folder, files, masterKey, request?.upload)
  const share = await createShare(stored.id, stored.fileKey, opts, { masterKey, itemIds: files.map((f) => f.id) })
  if (request) {
    try {
      await request.attach(share.id, opts.expiresIn ?? null)
    } catch (e) {
      // A link that promises uploads it cannot take is worse than no link.
      void api(`/api/shares/${share.id}`, { method: "DELETE" }).catch(() => {})
      throw e
    }
  }
  return share
}

/**
 * The key a link wraps its manifest's key with. Links made since folder links
 * follow their folder keep it sealed for their owner; for an older link it can
 * be derived again from the link secret, unless a password went into it too.
 */
async function linkWrapKey(share: DShare, masterKey: CryptoKey): Promise<CryptoKey | null> {
  if (!share.secret) return null
  try {
    if (share.encWrap) return await openShareWrap(masterKey, fromB64(share.encWrap), share.secret)
    if (share.hasPassword) return null
    const secret = b32decode(share.secret)
    return secret ? (await shareKeys(secret)).wrap : null
  } catch {
    return null
  }
}

/** A folder link whose manifest no longer shows what is in the folder. */
export type StaleLink = { key: string; bundle: DItem; folder: DFolder; files: BundleFile[]; shares: DShare[]; upload?: LinkUpload }

export async function staleFolderLinks(drive: Drive): Promise<StaleLink[]> {
  const folders = new Map(drive.folders.map((f) => [f.id, f]))
  const out: StaleLink[] = []
  for (const bundle of drive.bundles) {
    const folder = bundle.bundleOf ? folders.get(bundle.bundleOf) : undefined
    const shares = drive.sharesByItem.get(bundle.id) ?? []
    if (!folder || shares.length === 0) continue
    const files = collectFolder(drive, folder)
    const digest = await manifestDigest(folder.name, files)
    if (bundle.digest === digest) continue
    // A link that takes files keeps doing so: its new manifest names the same request.
    const request = drive.requests.find((r) => r.shareId && shares.some((s) => s.id === r.shareId))
    const upload =
      request?.access && request.publicKey
        ? { requestId: request.id, access: toB64(request.access), publicKey: toB64(request.publicKey) }
        : undefined
    out.push({ key: `${bundle.id}:${digest}`, bundle, folder, files, shares, upload })
  }
  return out
}

/** Uploads a fresh manifest for a stale folder link and points its links at it. Returns whether any link moved. */
export async function refreshFolderLink(stale: StaleLink, masterKey: CryptoKey): Promise<boolean> {
  const movable: { share: DShare; wrap: CryptoKey }[] = []
  for (const share of stale.shares) {
    const wrap = await linkWrapKey(share, masterKey)
    if (wrap) movable.push({ share, wrap })
  }
  if (movable.length === 0) return false
  const stored = await storeManifest(stale.folder, stale.files, masterKey, stale.upload)
  try {
    for (const { share, wrap } of movable) {
      await api(`/api/shares/${share.id}/item`, {
        method: "PUT",
        body: {
          itemId: stored.id,
          wrappedKey: toB64(await wrapForShare(wrap, stored.fileKey, stored.id)),
          itemIds: stale.files.map((f) => f.id),
        },
      })
    }
  } finally {
    stored.fileKey.fill(0)
  }
  return true
}

/**
 * A quick share of several files: each is uploaded under the same manage
 * token, then listed in an encrypted manifest that the link opens.
 */
export async function shareFiles(
  files: File[],
  opts: ShareOptions,
  expiresIn: number,
  onProgress?: (fraction: number) => void
): Promise<{ share: CreatedShare; itemId: string; manageToken: string; expiresAt: number }> {
  const total = files.reduce((n, f) => n + f.size, 0) || 1
  const entries: BundleFile[] = []
  const used = new Set<string>()
  let token: string | undefined
  let first: string | undefined
  let done = 0
  try {
    for (const f of files) {
      const stored = await storeItem({
        kind: "file",
        name: f.name,
        type: f.type,
        blob: f,
        expiresIn,
        manageToken: token,
        onProgress: (p) => onProgress?.((done + p * f.size) / total),
      })
      token ??= stored.manageToken
      first ??= stored.id
      done += f.size
      let path = f.name
      for (let n = 2; used.has(path); n++) path = f.name.replace(/(\.[^./]+)?$/, ` (${n})$1`)
      used.add(path)
      entries.push({
        id: stored.id,
        path,
        name: f.name,
        type: stored.meta.type,
        size: f.size,
        key: toB64(stored.fileKey),
        chunkSize: CHUNK_SIZE,
        chunkCount: stored.chunkCount,
        cipherSize: stored.cipherSize,
      })
      stored.fileKey.fill(0)
    }
    const manifest: Manifest = { v: 1, name: t("Shared files"), createdAt: Math.floor(Date.now() / 1000), files: entries }
    const bundle = await storeItem({
      kind: "bundle",
      name: manifest.name,
      type: BUNDLE_TYPE,
      blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      manageToken: token,
    })
    const share = await createShare(bundle.id, bundle.fileKey, opts, { manageToken: token, itemIds: entries.map((e) => e.id) })
    bundle.fileKey.fill(0)
    return { share, itemId: bundle.id, manageToken: token!, expiresAt: bundle.expiresAt! }
  } catch (e) {
    // Don't leave a half-built share behind; deleting one file removes them all.
    if (first && token) void api(`/api/items/${first}`, { method: "DELETE", headers: { "X-Manage-Token": token } }).catch(() => {})
    throw e
  }
}

export function fileBlobOpts(shareId: string, ticket: string, f: BundleFile) {
  return {
    url: `/api/s/${shareId}/blob?item=${encodeURIComponent(f.id)}`,
    headers: { "X-Ticket": ticket },
    fileKey: fromB64(f.key),
    chunkSize: f.chunkSize,
    chunkCount: f.chunkCount,
    size: f.cipherSize,
    name: f.name,
    type: f.type,
  }
}

type Writable = { write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
type SavePicker = (o: { suggestedName: string }) => Promise<{ createWritable(): Promise<Writable> }>

/**
 * Decrypts every file and streams them into a zip. Uses the File System Access
 * API to write straight to disk for large folders when available.
 * Returns the paths that could not be downloaded (e.g. deleted since sharing).
 */
export async function downloadZip(
  shareId: string,
  ticket: string,
  manifest: Manifest,
  onProgress?: (fraction: number) => void
): Promise<string[]> {
  const total = manifest.files.reduce((n, f) => n + f.cipherSize, 0) || 1
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  const zipName = `${safeFileName(manifest.name || "shared-folder")}.zip`

  let writable: Writable | null = null
  if (picker && total > 256 * 1024 * 1024) {
    try {
      writable = await (await picker({ suggestedName: zipName })).createWritable()
    } catch {
      return [] // user cancelled
    }
  }

  const parts: Uint8Array<ArrayBuffer>[] = []
  let pending = Promise.resolve()
  let finish!: () => void
  let fail!: (e: unknown) => void
  const finished = new Promise<void>((res, rej) => {
    finish = res
    fail = rej
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) return fail(err)
    if (writable) {
      const w = writable
      pending = pending.then(() => w.write(chunk))
    } else parts.push(chunk as Uint8Array<ArrayBuffer>)
    if (final) pending.then(finish, fail)
  })

  const failed: string[] = []
  const used = new Set<string>()
  let doneBytes = 0
  try {
    for (const f of manifest.files) {
      // Paths come from file names, which a stranger may have chosen: none may climb out of the archive.
      const clean = safePath(f.path)
      let path = clean
      for (let n = 2; used.has(path); n++) path = clean.replace(/(\.[^./]+)?$/, ` (${n})$1`)
      used.add(path)
      const entry = new ZipPassThrough(path)
      let started = false
      try {
        await downloadDecrypted({
          ...fileBlobOpts(shareId, ticket, f),
          sink: (p) => {
            if (!started) {
              zip.add(entry)
              started = true
            }
            entry.push(p)
          },
          onProgress: (p) => onProgress?.((doneBytes + p * f.cipherSize) / total),
        })
        if (!started) zip.add(entry)
        entry.push(new Uint8Array(0), true)
      } catch {
        if (started) throw new Error(t("Download of {path} was interrupted", { path: f.path }))
        failed.push(f.path)
      }
      doneBytes += f.cipherSize
      await pending
    }
    zip.end()
    await finished
  } catch (e) {
    await writable?.abort()
    throw e
  }

  if (writable) await writable.close()
  else {
    const url = URL.createObjectURL(new Blob(parts, { type: "application/zip" }))
    const a = document.createElement("a")
    a.href = url
    a.download = zipName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return failed
}
