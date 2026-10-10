import { useQuery } from "@tanstack/react-query"
import { api, type DriveData, type ItemRow, type ShareRow } from "./api"
import { fromB64, type ItemKind, itemKeys, openFromRequest, openMeta, openName, openShareSecret, unwrapFileKey } from "./crypto"
import { decryptRequest, type DRequest } from "./requests"
import { useSession } from "./session"
import { shareUrl } from "./transfer"

export type DFolder = { id: string; parentId: string | null; name: string; createdAt: number }

export type DItem = {
  id: string
  folderId: string | null
  kind: ItemKind
  /** For folder-share manifests: the folder they snapshot. */
  bundleOf?: string
  /** For folder-share manifests: a digest of what they list. */
  digest?: string
  /** For files that came in through a request: which one, and what the uploader chose to say. */
  requestId?: string
  from?: string
  note?: string
  /** Its key is still sealed to the request, not yet wrapped under the master key. */
  sealed: boolean
  name: string
  type: string
  size: number
  row: ItemRow
  fileKey: Uint8Array<ArrayBuffer> | null
  broken: boolean
  createdAt: number
}

export type DShare = ShareRow & { url: string | null; secret: string | null }

export type Drive = {
  folders: DFolder[]
  /** Files and notes (folder-share manifests are kept in `bundles`). */
  items: DItem[]
  bundles: DItem[]
  sharesByFolder: Map<string, DShare[]>
  shares: DShare[]
  sharesByItem: Map<string, DShare[]>
  requests: DRequest[]
  usage: { used: number; quota: number }
}

export async function decryptDrive(mk: CryptoKey, d: DriveData): Promise<Drive> {
  const folders = await Promise.all(
    d.folders.map(async (f) => ({
      id: f.id,
      parentId: f.parentId,
      createdAt: f.createdAt,
      name: await openName(mk, fromB64(f.encName)).catch(() => "Unreadable folder"),
    }))
  )
  const requests = await Promise.all((d.requests ?? []).map((r) => decryptRequest(mk, r)))
  const requestById = new Map(requests.map((r) => [r.id, r]))
  const fileKeyOf = async (row: ItemRow) => {
    if (row.wrappedKey) return unwrapFileKey(mk, fromB64(row.wrappedKey), row.id)
    // Came in through a request: the uploader sealed the key to its public key.
    const req = row.requestId ? requestById.get(row.requestId) : undefined
    if (!row.sealedKey || !req?.privateKey || !req.publicKey) throw new Error("no key")
    return openFromRequest(req.privateKey, req.publicKey, fromB64(row.sealedKey), req.id, row.id)
  }
  const items = await Promise.all(
    d.items.map(async (row): Promise<DItem> => {
      try {
        const fileKey = await fileKeyOf(row)
        const meta = await openMeta(await itemKeys(fileKey), fromB64(row.encMeta), row.id)
        return {
          id: row.id,
          folderId: row.folderId,
          kind: row.kind,
          bundleOf: meta.folderId,
          digest: meta.digest,
          requestId: row.requestId,
          from: meta.from,
          note: meta.note,
          sealed: !row.wrappedKey,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          row,
          fileKey,
          broken: false,
          createdAt: row.createdAt,
        }
      } catch {
        return {
          id: row.id,
          folderId: row.folderId,
          kind: row.kind,
          sealed: false,
          name: "Unreadable item",
          type: "",
          size: 0,
          row,
          fileKey: null,
          broken: true,
          createdAt: row.createdAt,
        }
      }
    })
  )
  const shares = await Promise.all(
    d.shares.map(async (s): Promise<DShare> => {
      let url: string | null = null
      let secret: string | null = null
      if (s.encSecret) {
        try {
          secret = await openShareSecret(mk, fromB64(s.encSecret))
          url = shareUrl(s.id, s.short ? null : secret)
        } catch {
          /* leave null */
        }
      }
      return { ...s, url, secret }
    })
  )
  const sharesByItem = new Map<string, DShare[]>()
  for (const s of shares) sharesByItem.set(s.itemId, [...(sharesByItem.get(s.itemId) ?? []), s])
  const bundles = items.filter((i) => i.kind === "bundle")
  const sharesByFolder = new Map<string, DShare[]>()
  for (const b of bundles) {
    if (!b.bundleOf) continue
    sharesByFolder.set(b.bundleOf, [...(sharesByFolder.get(b.bundleOf) ?? []), ...(sharesByItem.get(b.id) ?? [])])
  }
  return {
    folders,
    items: items.filter((i) => i.kind !== "bundle"),
    bundles,
    shares,
    sharesByItem,
    sharesByFolder,
    requests,
    usage: d.usage,
  }
}

export function useDrive() {
  const { masterKey, status } = useSession()
  return useQuery({
    queryKey: ["drive"],
    enabled: status === "unlocked" && !!masterKey,
    queryFn: async () => decryptDrive(masterKey!, await api<DriveData>("/api/drive")),
  })
}
