import { useQuery } from "@tanstack/react-query"
import { api, type DriveData, type ItemRow, type ShareRow } from "./api"
import { fromB64, type ItemKind, itemKeys, openMeta, openName, openShareSecret, unwrapFileKey } from "./crypto"
import { useSession } from "./session"
import { shareUrl } from "./transfer"

export type DFolder = { id: string; parentId: string | null; name: string; createdAt: number }

export type DItem = {
  id: string
  folderId: string | null
  kind: ItemKind
  /** For folder-share manifests: the folder they snapshot. */
  bundleOf?: string
  name: string
  type: string
  size: number
  row: ItemRow
  fileKey: Uint8Array<ArrayBuffer> | null
  broken: boolean
  createdAt: number
}

export type DShare = ShareRow & { url: string | null }

export type Drive = {
  folders: DFolder[]
  /** Files and notes (folder-share manifests are kept in `bundles`). */
  items: DItem[]
  bundles: DItem[]
  sharesByFolder: Map<string, DShare[]>
  shares: DShare[]
  sharesByItem: Map<string, DShare[]>
  usage: { used: number; quota: number }
}

async function decryptDrive(mk: CryptoKey, d: DriveData): Promise<Drive> {
  const folders = await Promise.all(
    d.folders.map(async (f) => ({
      id: f.id,
      parentId: f.parentId,
      createdAt: f.createdAt,
      name: await openName(mk, fromB64(f.encName)).catch(() => "Unreadable folder"),
    })),
  )
  const items = await Promise.all(
    d.items.map(async (row): Promise<DItem> => {
      try {
        const fileKey = await unwrapFileKey(mk, fromB64(row.wrappedKey), row.id)
        const meta = await openMeta(await itemKeys(fileKey), fromB64(row.encMeta), row.id)
        return { id: row.id, folderId: row.folderId, kind: row.kind, bundleOf: meta.folderId, name: meta.name, type: meta.type, size: meta.size, row, fileKey, broken: false, createdAt: row.createdAt }
      } catch {
        return { id: row.id, folderId: row.folderId, kind: row.kind, name: "Unreadable item", type: "", size: 0, row, fileKey: null, broken: true, createdAt: row.createdAt }
      }
    }),
  )
  const shares = await Promise.all(
    d.shares.map(async (s): Promise<DShare> => {
      let url: string | null = null
      if (s.encSecret) {
        try {
          url = shareUrl(s.id, s.short ? null : await openShareSecret(mk, fromB64(s.encSecret)))
        } catch {
          /* leave null */
        }
      }
      return { ...s, url }
    }),
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
