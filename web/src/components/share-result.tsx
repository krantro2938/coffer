import { useMemo, useState } from "react"
import { renderSVG } from "uqr"
import { CheckIcon, CopyIcon, ExternalLinkIcon, QrCodeIcon, Share2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatSecret } from "@/lib/crypto"
import { relativeTime } from "@/lib/format"
import { useI18n } from "@/lib/i18n"
import { useCopy } from "@/hooks/use-copy"
import type { CreatedShare } from "@/lib/transfer"
import { cn } from "@/lib/utils"

export function ShareResult({
  share,
  hasPassword,
  maxViews,
  className,
}: {
  share: CreatedShare
  hasPassword?: boolean
  maxViews?: number | null
  className?: string
}) {
  const { copy, copied } = useCopy()
  const { t, tn } = useI18n()
  const [qr, setQr] = useState(false)
  const code = share.short ? share.id : `${share.id} ${formatSecret(share.secret)}`
  const svg = useMemo(
    () => (qr ? renderSVG(share.url, { border: 1, pixelSize: 6, whiteColor: "#ffffff", blackColor: "#13201a" }) : ""),
    [qr, share.url]
  )
  const canShare = typeof navigator !== "undefined" && "share" in navigator

  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4", className)}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
        <span className="eyebrow">{t("Share link")}</span>
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-1.5 pl-3.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]" title={share.url}>
            {share.url}
          </code>
          <Button size="sm" onClick={() => copy(share.url, t("Link copied"))} className="shrink-0">
            {copied === share.url ? <CheckIcon /> : <CopyIcon />}
            {t("Copy")}
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
        <span className="eyebrow">{t("Or type this code at /receive")}</span>
        <button
          type="button"
          onClick={() => copy(code, t("Code copied"))}
          className="group flex items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/40 px-3.5 py-3 text-left transition-colors hover:bg-muted"
        >
          <span className="min-w-0 font-mono text-[0.9375rem] tracking-wide break-all">
            <span className="font-semibold text-primary">{share.id}</span>
            {!share.short && <span className="text-muted-foreground"> {formatSecret(share.secret)}</span>}
          </span>
          {copied === code ? (
            <CheckIcon className="size-4 text-primary" />
          ) : (
            <CopyIcon className="size-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{share.expiresAt ? t("Expires {when}", { when: relativeTime(share.expiresAt) }) : t("Never expires")}</span>
        {maxViews ? <span>{maxViews === 1 ? t("Burns after first view") : tn(maxViews, "{n} view", "{n} views")}</span> : null}
        {hasPassword ? <span>{t("Password protected")}</span> : null}
      </div>

      {qr && (
        <div className="mx-auto rounded-2xl bg-white p-3 shadow-soft">
          <div className="size-48 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setQr((q) => !q)}>
          <QrCodeIcon /> {qr ? t("Hide QR") : t("QR code")}
        </Button>
        {canShare && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.share({ title: t("Encrypted share"), url: share.url }).catch(() => {})}
          >
            <Share2Icon /> {t("Share")}
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <a href={share.url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon /> {t("Open")}
          </a>
        </Button>
      </div>
    </div>
  )
}
