import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ArrowRightIcon, InboxIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SiteHeader } from "@/components/site-header"
import { normalizeCode } from "@/lib/crypto"

export const Route = createFileRoute("/receive")({ component: Receive })

/** Accepts a full link, "id secret", "id#secret" or the two parts separately. */
function parse(idRaw: string, keyRaw: string): { id: string; secret: string } | null {
  const m = idRaw.match(/\/s\/([0-9a-z]{7})(?:#([\w-]+))?/i)
  if (m) return { id: normalizeCode(m[1]), secret: normalizeCode(m[2] ?? keyRaw) }
  const parts = idRaw.trim().split(/[\s#/]+/).filter(Boolean)
  const id = normalizeCode(parts[0] ?? "")
  const secret = normalizeCode(parts.slice(1).join("") || keyRaw)
  if (id.length !== 7) return null
  return { id, secret }
}

function Receive() {
  const navigate = useNavigate()
  const [id, setId] = useState("")
  const [key, setKey] = useState("")

  const go = () => {
    const p = parse(id, key)
    if (!p) {
      toast.error("That code doesn't look right", { description: "Codes look like k7m3xq2 followed by the key." })
      return
    }
    // Navigate with the key in the fragment so it never hits the server.
    navigate({ to: "/s/$id", params: { id: p.id }, hash: p.secret })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-20 sm:items-center sm:pt-0">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
          className="grid w-full max-w-md gap-6 rounded-[1.75rem] border bg-card p-6 shadow-soft sm:p-8"
        >
          <div className="grid gap-4">
            <span className="grid size-12 place-items-center rounded-2xl bg-lavender-soft text-accent-foreground">
              <InboxIcon className="size-5" />
            </span>
            <div>
              <h1 className="text-2xl font-medium">Receive a share</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Type the short code you were given, or paste the full link. Letters are case-insensitive and look-alikes
                like O/0 are forgiven.
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="code" className="eyebrow">
                Code or link
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
                <label htmlFor="key" className="eyebrow">
                  Key
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
            Continue <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </form>
      </main>
    </div>
  )
}
