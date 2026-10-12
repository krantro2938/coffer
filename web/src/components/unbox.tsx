import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FolderLockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { sealName, toB64 } from "@/lib/crypto"
import { formatBytes } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { saveWelcome, starterFolders, type Welcome } from "@/lib/welcome"

/**
 * The first opening of a new drive: the lock turns while the starter folders
 * are created (encrypted here, like everything else), then opens.
 */
export function Unbox({ welcome, onDone }: { welcome: Welcome; onDone: () => void }) {
  const { me, masterKey } = useSession()
  const { t } = useI18n()
  const qc = useQueryClient()
  // `open`: the lock has opened, big and alone. `settled`: it has come down to its place and the words arrive.
  const [open, setOpen] = useState(false)
  const [settled, setSettled] = useState(false)
  const slot = useRef<HTMLDivElement>(null)
  // How far below its place the lock starts, so it begins at the middle of the screen.
  const [drop, setDrop] = useState(0)
  const names = useRef(starterFolders(welcome.picks).map((n) => t(n))).current
  const started = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const quota = me?.quota

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
      await new Promise((r) => setTimeout(r, 1000))
      setSettled(true)
    })()
  }, [masterKey, names, qc])

  useLayoutEffect(() => {
    const r = slot.current?.getBoundingClientRect()
    if (r) setDrop(window.innerHeight / 2 - (r.top + r.height / 2))
  }, [])

  // The button is mounted from the start (hidden), so focus it only once it shows.
  useEffect(() => {
    if (settled) button.current?.focus({ preventScroll: true })
  }, [settled])

  const ease = "ease-[cubic-bezier(0.22,1,0.36,1)]"
  // Everything is mounted from the start and only fades and drifts into place, so nothing jumps when the lock opens.
  const reveal = (delay: number) => ({
    className: cn(
      "transition-[opacity,transform] duration-[900ms] motion-reduce:transition-none",
      ease,
      settled ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
    ),
    style: { transitionDelay: settled ? `${delay}ms` : "0ms" },
  })

  return (
    <div className="relative grid min-h-svh place-items-center overflow-hidden px-4 py-10">
      <div className="relative grid w-full max-w-md justify-items-center text-center">
        <div ref={slot} className="relative size-60 sm:size-72">
          {/* The lock starts large at the middle of the screen, opens, then comes down to its place. */}
          <div
            className={cn(
              "absolute inset-0 will-change-transform",
              settled
                ? "scale-100 transition-transform duration-[1500ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                : "scale-[1.45] sm:scale-[1.8]"
            )}
            style={{ translate: settled ? "0 0" : `0 ${drop}px` }}
          >
            {/* Light pooling behind the lock; it blooms when the lock opens. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 left-1/2 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,scale] duration-[1600ms] ease-out motion-reduce:transition-none",
                "bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--lime)_30%,transparent),color-mix(in_oklch,var(--mint)_24%,transparent)_55%,transparent)]",
                open ? "scale-100 opacity-100" : "scale-75 opacity-30"
              )}
            />
            <div className="absolute inset-0 animate-float">
              {/* Closed lock: fades away as the open one arrives. */}
              <img
                src="/3d/lock.webp"
                alt=""
                className={cn(
                  "absolute inset-0 size-full object-contain transition-opacity duration-500 ease-in-out motion-reduce:transition-none",
                  open ? "opacity-0" : "opacity-100"
                )}
              />
              {/* The open render arrives a little larger than the closed one and settles to its size, which hides how the two differ. */}
              <img
                src="/3d/lock-open.webp"
                alt=""
                className={cn(
                  "absolute inset-0 size-full object-contain transition-[opacity,scale] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  open ? "scale-100 opacity-100 duration-[1100ms]" : "scale-[1.16] opacity-0 duration-500"
                )}
              />
            </div>
            <div aria-hidden className="absolute -bottom-3 left-1/2 h-5 w-40 -translate-x-1/2 rounded-full bg-foreground/10 blur-xl" />
          </div>
        </div>

        {/* The result is laid out from the start (hidden), so the lock never shifts. */}
        <div className="mt-10 grid w-full">
          <div inert={!settled} className="grid w-full justify-items-center gap-8">
            <div {...reveal(500)}>
              <h1 className="text-5xl leading-[1.02] font-medium text-balance sm:text-6xl">{t("Your private drive is ready.")}</h1>
              <p className="mx-auto mt-4 max-w-sm text-pretty text-muted-foreground">
                {quota && quota > 0
                  ? t("{size} that only you can read. Not us, not our storage provider, not anyone who gets hold of our disks.", {
                      size: formatBytes(quota),
                    })
                  : t("Space that only you can read. Not us, not our storage provider, not anyone who gets hold of our disks.")}
              </p>
            </div>
            {names.length > 0 && (
              <div {...reveal(650)} className={cn(reveal(650).className, "w-full")}>
                <ul className="grid w-full divide-y overflow-hidden rounded-2xl border bg-card text-left shadow-soft">
                  {names.map((name) => (
                    <li key={name} className="flex items-center gap-3 px-4 py-3">
                      <FolderLockIcon className="size-4 text-primary" strokeWidth={1.75} />
                      <span className="flex-1 truncate text-sm font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">{t("Name encrypted")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div {...reveal(800 + names.length * 100)}>
              <Button size="lg" onClick={onDone} ref={button}>
                {t("Open my drive")}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <p
        role="status"
        aria-hidden={open}
        className={cn(
          "absolute inset-x-0 top-[calc(50%+12rem)] text-center text-sm text-muted-foreground transition-opacity duration-500 motion-reduce:transition-none sm:top-[calc(50%+17.5rem)]",
          open ? "opacity-0" : "opacity-100"
        )}
      >
        {t("Setting the combination…")}
      </p>
    </div>
  )
}
