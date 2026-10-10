/**
 * Optional "keep me unlocked on this device" storage. The master key is kept
 * as a non-extractable CryptoKey in IndexedDB: scripts on this origin can use
 * it but can never export its raw bytes.
 */
const DB = "coffer"
const STORE = "keys"

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest, name = DB): Promise<T> {
  // Some private/locked-down browsers leave IndexedDB requests pending forever.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("IndexedDB timeout")), 2000))
  const db = await Promise.race([open(name), timeout])
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close())
}

export async function saveKey(email: string, key: CryptoKey) {
  try {
    await tx("readwrite", (s) => s.put(key, email.toLowerCase()))
  } catch {
    /* IndexedDB unavailable (private mode) — stay memory-only */
  }
}

export async function loadKey(email: string): Promise<CryptoKey | null> {
  try {
    return (await tx<CryptoKey | undefined>("readonly", (s) => s.get(email.toLowerCase()))) ?? null
  } catch {
    return null
  }
}

export async function clearKeys() {
  try {
    await tx("readwrite", (s) => s.clear())
  } catch {
    /* ignore */
  }
}

/**
 * A key that belongs to this browser rather than to an account. It seals the
 * small things kept in localStorage (the list of quick shares made here) and
 * survives signing out. Returns null when IndexedDB is unavailable.
 */
let device: Promise<CryptoKey | null> | null = null
export function deviceKey(): Promise<CryptoKey | null> {
  device ??= (async () => {
    const name = "coffer-device"
    try {
      const existing = await tx<CryptoKey | undefined>("readonly", (s) => s.get("local"), name)
      if (existing) return existing
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
      await tx("readwrite", (s) => s.put(key, "local"), name)
      // Another tab may have won the race; use whichever key was stored.
      return (await tx<CryptoKey | undefined>("readonly", (s) => s.get("local"), name)) ?? key
    } catch {
      return null
    }
  })()
  return device
}
