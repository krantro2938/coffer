/**
 * Optional "keep me unlocked on this device" storage. The master key is kept
 * as a non-extractable CryptoKey in IndexedDB: scripts on this origin can use
 * it but can never export its raw bytes.
 */
const DB = "coffer"
const STORE = "keys"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
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
