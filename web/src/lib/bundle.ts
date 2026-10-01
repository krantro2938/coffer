/**
 * Folder sharing. A folder link shares an encrypted manifest (a "bundle" item)
 * listing a snapshot of the folder's files together with their file keys. The
 * server only learns which item ids the link may serve — never names or keys.
 */
import { Zip, ZipPassThrough } from "fflate"
import { fromB64, toB64 } from "./crypto"
import type { DFolder, Drive } from "./drive"
import { createShare, downloadDecrypted, storeItem, type CreatedShare, type ShareOptions } from "./transfer"
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

export type Manifest = { v: 1; name: string; createdAt: number; files: BundleFile[] }

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

export async function shareFolder(
  drive: Drive,
  folder: DFolder,
  opts: ShareOptions,
  masterKey: CryptoKey,
): Promise<CreatedShare> {
  const files = collectFolder(drive, folder)
  if (files.length === 0) throw new Error(t("This folder has no files to share yet"))
  const manifest: Manifest = { v: 1, name: folder.name, createdAt: Math.floor(Date.now() / 1000), files }
  const stored = await storeItem({
    kind: "bundle",
    name: folder.name,
    type: BUNDLE_TYPE,
    blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
    masterKey,
    metaFolderId: folder.id,
  })
  return createShare(stored.id, stored.fileKey, opts, { masterKey, itemIds: files.map((f) => f.id) })
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
  onProgress?: (fraction: number) => void,
): Promise<string[]> {
  const total = manifest.files.reduce((n, f) => n + f.cipherSize, 0) || 1
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  const zipName = `${manifest.name || "shared-folder"}.zip`

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
      let path = f.path
      for (let n = 2; used.has(path); n++) path = f.path.replace(/(\.[^./]+)?$/, ` (${n})$1`)
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
