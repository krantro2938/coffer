import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api, canWrite } from "./api"
import { refreshFolderLink, staleFolderLinks } from "./bundle"
import { toB64, wrapFileKey } from "./crypto"
import { useDrive } from "./drive"
import { useSession } from "./session"

/**
 * Housekeeping only this browser can do, because only it holds the keys. It
 * runs whenever the drive is open and has changed:
 *
 * - files that came in through a file request have their key re-wrapped under
 *   the master key, which makes them ordinary drive items;
 * - folder links whose folder has changed get a fresh manifest.
 */
export function useDriveSync() {
  const { masterKey, me } = useSession()
  const { data } = useDrive()
  const qc = useQueryClient()
  const busy = useRef(false)
  // What failed once is not tried again until the page is reloaded.
  const skip = useRef(new Set<string>())
  const writable = canWrite(me)

  useEffect(() => {
    if (!data || !masterKey) return
    // Let a burst of changes (a multi-file upload) settle first.
    const timer = setTimeout(async () => {
      if (busy.current) return
      busy.current = true
      let changed = false
      try {
        for (const item of data.items) {
          if (!item.sealed || !item.fileKey || skip.current.has(item.id)) continue
          try {
            await api(`/api/items/${item.id}/adopt`, { body: { wrappedKey: toB64(await wrapFileKey(masterKey, item.fileKey, item.id)) } })
            changed = true
          } catch {
            skip.current.add(item.id)
          }
        }
        // A read-only drive cannot take a new manifest.
        if (writable) {
          for (const stale of await staleFolderLinks(data)) {
            if (skip.current.has(stale.key)) continue
            try {
              if (await refreshFolderLink(stale, masterKey)) changed = true
              else skip.current.add(stale.key)
            } catch {
              skip.current.add(stale.key)
            }
          }
        }
      } finally {
        busy.current = false
        if (changed) void qc.invalidateQueries({ queryKey: ["drive"] })
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [data, masterKey, writable, qc])
}
