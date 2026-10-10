import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FolderLockIcon } from "lucide-react"
import { Dial } from "@/components/dial"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { sealName, toB64 } from "@/lib/crypto"
import { formatBytes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { saveWelcome, starterFolders, type Welcome } from "@/lib/welcome"

/**
 * The first opening of a new drive: the dial turns, lines up and opens while
 * the starter folders are created (encrypted here, like everything else).
 */
export function Unbox({ welcome, onDone }: { welcome: Welcome; onDone: () => void }) {
  const { me, masterKey } = useSession()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const names = useRef(starterFolders(welcome.picks).map((n) => t(n))).current
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !masterKey) return
    started.current = true
    ;(async () => {
      const turn = new Promise((r) => setTimeout(r, 2200))
      try {
        for (const name of names) await api("/api/folders", { body: { encName: toB64(await sealName(masterKey, name)) } })
      } catch {
        /* the drive still opens; folders can be made by hand */
      }
      // The folders exist now; a reload must not create them twice.
      saveWelcome(null)
      void qc.invalidateQueries({ queryKey: ["drive"] })
      await turn
      setOpen(true)
    })()
  }, [masterKey, names, qc])

  return (
    <div className="grid min-h-svh place-items-center overflow-hidden bg-forest px-4 py-10 text-forest-foreground">
      <div className="grid w-full max-w-md justify-items-center text-center">
        <Dial state={open ? "open" : "turning"} className="size-56 text-mint sm:size-64" />
        {open ? (
          <div className="mt-8 grid w-full justify-items-center gap-8">
            <div className="animate-rise" style={{ animationDelay: "1.1s" }}>
              <h1 className="text-5xl leading-[1.02] font-medium sm:text-6xl">{t("Your drive is open.")}</h1>
              <p className="mx-auto mt-4 max-w-sm text-pretty text-forest-foreground/70">
                {me && me.quota > 0
                  ? t("{size} that only you can read. Not us, not our storage provider, not anyone who gets hold of our disks.", {
                      size: formatBytes(me.quota),
                    })
                  : t("Space that only you can read. Not us, not our storage provider, not anyone who gets hold of our disks.")}
              </p>
            </div>
            {names.length > 0 && (
              <ul className="grid w-full gap-1.5 text-left">
                {names.map((name, i) => (
                  <li
                    key={name}
                    className="flex animate-rise items-center gap-3 rounded-xl bg-white/[0.07] px-4 py-3"
                    style={{ animationDelay: `${1.5 + i * 0.12}s` }}
                  >
                    <FolderLockIcon className="size-4 text-mint" strokeWidth={1.75} />
                    <span className="flex-1 truncate text-sm font-medium">{name}</span>
                    <span className="text-xs text-forest-foreground/50">{t("Name encrypted")}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="animate-rise" style={{ animationDelay: `${1.7 + names.length * 0.12}s` }}>
              <Button size="lg" variant="secondary" onClick={onDone} autoFocus>
                {t("Open my drive")}
              </Button>
            </div>
          </div>
        ) : (
          <p role="status" className="mt-8 text-sm text-forest-foreground/60">
            {t("Setting the combination…")}
          </p>
        )}
      </div>
    </div>
  )
}
