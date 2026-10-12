import { createFileRoute } from "@tanstack/react-router"
import { DropComposer } from "@/components/drop-composer"
import { useI18n } from "@/lib/i18n"

export const Route = createFileRoute("/_app/share")({ component: SharePage })

function SharePage() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-16 sm:px-8 sm:pt-10 sm:pb-24">
      <p className="eyebrow">{t("Send a file or a note")}</p>
      <h1 className="mt-1.5 text-4xl font-semibold tracking-tight">{t("Quick share")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Drop it here and get a link. Add a password, an expiry or a view limit if you like.")}
      </p>
      <div className="mt-8">
        <DropComposer />
      </div>
    </div>
  )
}
