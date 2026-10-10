/**
 * The quick shares made in this browser, kept so they can be cancelled later
 * without an account. The list sits in localStorage, sealed with a key that
 * never leaves this browser, and holds no link secrets: it can revoke a
 * share, not open one.
 */
import { api, ApiError } from "./api"
import { fromB64, randomBytes, toB64 } from "./crypto"
import { deviceKey } from "./keystore"

export type Drop = {
  itemId: string
  manageToken: string
  shareId: string
  name: string
  kind: "file" | "text" | "bundle"
  files: number
  expiresAt: number
}

const KEY = "coffer-drops"
const SEALED = "v2:"
const MAX = 20

const alive = (d: Drop) => d.expiresAt > Date.now() / 1000

export async function loadDrops(): Promise<Drop[]> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    if (!raw.startsWith(SEALED)) {
      // Lists written before sealing was added: re-save them sealed.
      const legacy = (JSON.parse(raw) as Drop[]).map((d) => ({ ...d, files: d.files ?? 1 })).filter(alive)
      await saveDrops(legacy)
      return legacy
    }
    const key = await deviceKey()
    if (!key) return []
    const bytes = fromB64(raw.slice(SEALED.length))
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))
    return (JSON.parse(new TextDecoder().decode(plain)) as Drop[]).filter(alive)
  } catch {
    return []
  }
}

export async function saveDrops(drops: Drop[]) {
  try {
    const key = await deviceKey()
    // Without a device key (private windows) nothing is written rather than writing it in the clear.
    if (!key || drops.length === 0) return localStorage.removeItem(KEY)
    const iv = randomBytes(12)
    const plain = new TextEncoder().encode(JSON.stringify(drops.slice(0, MAX)))
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain))
    const out = new Uint8Array(12 + sealed.length)
    out.set(iv)
    out.set(sealed, 12)
    localStorage.setItem(KEY, SEALED + toB64(out))
  } catch {
    /* storage unavailable */
  }
}

/** Drops whose link the server no longer serves: expired, used up or deleted. */
export async function pruneDrops(drops: Drop[]): Promise<Drop[]> {
  const checked = await Promise.all(
    drops.map(async (d) => {
      try {
        const s = await api<{ active: boolean }>(`/api/items/${d.itemId}/status`, { headers: { "X-Manage-Token": d.manageToken } })
        return s.active
      } catch (e) {
        // Only forget a share the server says is gone; keep it through network trouble.
        return !(e instanceof ApiError && e.status === 404)
      }
    })
  )
  return drops.filter((_, i) => checked[i])
}

export async function revokeDrop(d: Drop) {
  try {
    await api(`/api/items/${d.itemId}`, { method: "DELETE", headers: { "X-Manage-Token": d.manageToken } })
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
  }
}
