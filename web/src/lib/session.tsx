import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api, ApiError, type Me } from "./api"
import {
  accountKeys,
  b32decode,
  formatRecoveryKey,
  fromB64,
  importMasterKey,
  KDF_DEFAULT,
  randomBytes,
  recoveryKeys,
  toB64,
  unwrapMasterKeyRaw,
  wrapMasterKey,
  DecryptError,
  type KdfParams,
} from "./crypto"
import { currentLang } from "./i18n"
import { clearKeys, loadKey, saveKey } from "./keystore"

// Set while a key is parked in IndexedDB only to survive a round trip to the
// checkout. The next page load takes the key back out and forgets the copy.
const HOLD = "coffer-hold"
const HOLD_MAX = 2 * 3600 * 1000

function takeHold(): number | null {
  try {
    const at = localStorage.getItem(HOLD)
    localStorage.removeItem(HOLD)
    return at ? Number(at) : null
  } catch {
    return null
  }
}

export type SessionStatus = "loading" | "anonymous" | "locked" | "unlocked"

type Session = {
  status: SessionStatus
  me: Me | null
  masterKey: CryptoKey | null
  register: (email: string, password: string, remember: boolean, invite?: string) => Promise<string>
  /** Keeps the drive unlocked across one trip to another page and back (the checkout). */
  holdKey: () => Promise<void>
  login: (email: string, password: string, remember: boolean) => Promise<void>
  unlock: (password: string, remember: boolean) => Promise<void>
  lock: () => Promise<void>
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  recover: (email: string, recoveryKey: string, password: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
  refresh: () => Promise<void>
  /** Adopts account details the server just returned (e.g. after a plan change). */
  updateMe: (me: Me) => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession() {
  const s = useContext(SessionContext)
  if (!s) throw new Error("useSession outside SessionProvider")
  return s
}

async function unwrapWithPassword(me: Pick<Me, "salt" | "kdf" | "wrappedMasterKey">, password: string) {
  const keys = await accountKeys(password, fromB64(me.salt), me.kdf)
  try {
    const raw = await unwrapMasterKeyRaw(keys.kek, fromB64(me.wrappedMasterKey))
    return { keys, raw }
  } catch (e) {
    if (e instanceof DecryptError) throw new ApiError(401, "Incorrect password")
    throw e
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const [me, setMe] = useState<Me | null>(null)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [status, setStatus] = useState<SessionStatus>("loading")

  const adopt = useCallback(async (next: Me, raw: Uint8Array<ArrayBuffer>, remember: boolean) => {
    const mk = await importMasterKey(raw)
    raw.fill(0)
    await clearKeys()
    if (remember) await saveKey(next.email, mk)
    setMe(next)
    setMasterKey(mk)
    setStatus("unlocked")
  }, [])

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/auth/me"))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await clearKeys()
        setMe(null)
        setMasterKey(null)
        setStatus("anonymous")
      }
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const m = await api<Me>("/api/auth/me")
        setMe(m)
        let key = await loadKey(m.email)
        const held = takeHold()
        if (held !== null) {
          await clearKeys()
          if (Date.now() - held > HOLD_MAX) key = null
        }
        setMasterKey(key)
        setStatus(key ? "unlocked" : "locked")
      } catch {
        setStatus("anonymous")
        void clearKeys()
      }
    })()
  }, [])

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const params = await api<{ salt: string; kdf: KdfParams }>("/api/auth/params", { body: { email } })
      const keys = await accountKeys(password, fromB64(params.salt), params.kdf)
      const m = await api<Me>("/api/auth/login", { body: { email, authKey: toB64(keys.authKey) } })
      const raw = await unwrapMasterKeyRaw(keys.kek, fromB64(m.wrappedMasterKey))
      await adopt(m, raw, remember)
    },
    [adopt]
  )

  const register = useCallback(
    async (email: string, password: string, remember: boolean, invite?: string) => {
      const salt = randomBytes(16)
      const keys = await accountKeys(password, salt, KDF_DEFAULT)
      const raw = randomBytes(32)
      const recovery = randomBytes(32)
      const rkeys = await recoveryKeys(recovery)
      const m = await api<Me>("/api/auth/register", {
        body: {
          email,
          salt: toB64(salt),
          kdf: KDF_DEFAULT,
          authKey: toB64(keys.authKey),
          wrappedMasterKey: toB64(await wrapMasterKey(keys.kek, raw)),
          recoveryAuthKey: toB64(rkeys.authKey),
          recoveryWrappedMasterKey: toB64(await wrapMasterKey(rkeys.kek, raw)),
          lang: currentLang(),
          invite,
        },
      })
      const code = formatRecoveryKey(recovery)
      recovery.fill(0)
      await adopt(m, raw, remember)
      return code
    },
    [adopt]
  )

  const holdKey = useCallback(async () => {
    if (!me || !masterKey || (await loadKey(me.email))) return // nothing to hold, or already kept on this device
    await saveKey(me.email, masterKey)
    try {
      localStorage.setItem(HOLD, String(Date.now()))
    } catch {
      await clearKeys()
    }
  }, [me, masterKey])

  const unlock = useCallback(
    async (password: string, remember: boolean) => {
      if (!me) throw new ApiError(401, "Not signed in")
      const { raw } = await unwrapWithPassword(me, password)
      await adopt(me, raw, remember)
    },
    [me, adopt]
  )

  const lock = useCallback(async () => {
    await clearKeys()
    setMasterKey(null)
    setStatus("locked")
    qc.removeQueries({ queryKey: ["drive"] })
  }, [qc])

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" })
    } finally {
      await clearKeys()
      setMe(null)
      setMasterKey(null)
      setStatus("anonymous")
      qc.clear()
    }
  }, [qc])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!me) throw new ApiError(401, "Not signed in")
      const { keys, raw } = await unwrapWithPassword(me, current)
      const salt = randomBytes(16)
      const nk = await accountKeys(next, salt, KDF_DEFAULT)
      const m = await api<Me>("/api/auth/password", {
        body: {
          authKey: toB64(keys.authKey),
          salt: toB64(salt),
          kdf: KDF_DEFAULT,
          newAuthKey: toB64(nk.authKey),
          wrappedMasterKey: toB64(await wrapMasterKey(nk.kek, raw)),
        },
      })
      raw.fill(0)
      setMe(m)
    },
    [me]
  )

  const recover = useCallback(
    async (email: string, recoveryKey: string, password: string) => {
      const rbytes = b32decode(recoveryKey)
      if (!rbytes || rbytes.length !== 32) throw new ApiError(400, "That recovery key doesn't look right")
      const rk = await recoveryKeys(rbytes)
      const { recoveryWrappedMasterKey } = await api<{ recoveryWrappedMasterKey: string }>("/api/auth/recover/start", {
        body: { email, recoveryAuthKey: toB64(rk.authKey) },
      })
      const raw = await unwrapMasterKeyRaw(rk.kek, fromB64(recoveryWrappedMasterKey))
      const salt = randomBytes(16)
      const nk = await accountKeys(password, salt, KDF_DEFAULT)
      const m = await api<Me>("/api/auth/recover/finish", {
        body: {
          email,
          recoveryAuthKey: toB64(rk.authKey),
          salt: toB64(salt),
          kdf: KDF_DEFAULT,
          authKey: toB64(nk.authKey),
          wrappedMasterKey: toB64(await wrapMasterKey(nk.kek, raw)),
        },
      })
      await adopt(m, raw, false)
    },
    [adopt]
  )

  const deleteAccount = useCallback(
    async (password: string) => {
      if (!me) throw new ApiError(401, "Not signed in")
      const { keys, raw } = await unwrapWithPassword(me, password)
      raw.fill(0)
      await api("/api/auth/delete", { body: { authKey: toB64(keys.authKey) } })
      await clearKeys()
      setMe(null)
      setMasterKey(null)
      setStatus("anonymous")
      qc.clear()
    },
    [me, qc]
  )

  const value = useMemo(
    () => ({
      status,
      me,
      masterKey,
      register,
      login,
      unlock,
      lock,
      logout,
      changePassword,
      recover,
      deleteAccount,
      refresh,
      updateMe: setMe,
      holdKey,
    }),
    [holdKey, status, me, masterKey, register, login, unlock, lock, logout, changePassword, recover, deleteAccount, refresh]
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
