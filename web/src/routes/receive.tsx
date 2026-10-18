import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ArrowRightIcon, InboxIcon, LockKeyholeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GrowthNote, RecipientStage } from "@/components/recipient-stage"
import { SiteHeader } from "@/components/site-header"
import { normalizeCode } from "@/lib/crypto"
import { useI18n } from "@/lib/i18n"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/receive")({
  head: () => ({
    meta: [
      { title: "Receive a share — Coffer" },
      {
        name: "description",
        content: "Open something that was shared with you through Coffer by typing its short code. It is decrypted in your browser.",
      },
    ],
  }),
  component: Receive,
})

/** Accepts a full link, "id secret", "id#secret" or the two parts separately. */
function parse(idRaw: string, keyRaw: string): { id: string; secret: string } | null {
  const m = idRaw.match(/\/s\/([0-9a-z]{7})(?:#([\w-]+))?/i)
  if (m) return { id: normalizeCode(m[1]), secret: normalizeCode(m[2] ?? keyRaw) }
  const parts = idRaw
    .trim()
    .split(/[\s#/]+/)
    .filter(Boolean)
  const id = normalizeCode(parts[0] ?? "")
  const secret = normalizeCode(parts.slice(1).join("") || keyRaw)
  if (id.length !== 7) return null
  return { id, secret }
}

function Receive() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [id, setId] = useState("")
  const [key, setKey] = useState("")

  const go = () => {
    const p = parse(id, key)
    if (!p) {
      toast.error(t("That code doesn't look right"), { description: t("Codes look like k7m3xq2 followed by the key.") })
      return
    }
    // Navigate with the key in the fragment so it never hits the server.
    navigate({ to: "/s/$id", params: { id: p.id }, hash: p.secret })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <RecipientStage>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
          className="grid min-w-0 gap-5 overflow-hidden rounded-[2rem] bg-card p-6 text-card-foreground shadow-[0_30px_60px_-20px_oklch(0.2_0.05_158/45%)] sm:p-8"
        >
          <div className="grid gap-4 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <InboxIcon className="size-6" />
            </span>
            <div>
              <h1 className="text-2xl font-medium">{t("Receive a share")}</h1>
              <p className="mt-2 text-sm text-pretty text-muted-foreground">
                {t(
                  "Type the short code you were given, or paste the full link. Letters are case-insensitive and look-alikes like O/0 are forgiven."
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="code" className="text-sm font-medium">
                {t("Code or link")}
              </label>
              <Input
                id="code"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="k7m3xq2"
                className="h-12 font-mono text-lg tracking-wider"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
            </div>
            {!id.includes("#") && !/\s\S/.test(id.trim()) && (
              <div className="grid gap-1.5">
                <label htmlFor="key" className="text-sm font-medium">
                  {t("Key")}
                </label>
                <Input
                  id="key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="h4c9-w2pz-8rtf-6mxn"
                  className="h-12 font-mono tracking-wider"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
          <Button size="lg" type="submit" disabled={!id.trim()}>
            {t("Continue")} <ArrowRightIcon data-icon="inline-end" />
          </Button>
          <p className="text-center text-xs text-pretty text-muted-foreground">
            <LockKeyholeIcon className="mr-1.5 inline size-3.5 -translate-y-px" />
            {t("The key stays in your browser. It decrypts the share here, and never reaches our server.")}
          </p>
        </form>
        <GrowthNote text={t("Send your own files the same way. No account needed.")} label={t("Share something yourself")} to="/" />
      </RecipientStage>
    </div>
  )
}
