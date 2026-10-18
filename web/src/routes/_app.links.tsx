import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ShareList } from "@/components/drive-dialogs"
import { useDrive } from "@/lib/drive"
import { useI18n } from "@/lib/i18n"

export const Route = createFileRoute("/_app/links")({ component: LinksPage })

function LinksPage() {
  const { data, isLoading } = useDrive()
  const { t } = useI18n()
  const names = useMemo(() => new Map([...(data?.items ?? []), ...(data?.bundles ?? [])].map((i) => [i.id, i])), [data])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p className="eyebrow">{t("Active links")}</p>
      <h1 className="mt-1.5 text-4xl font-semibold tracking-tight">{t("Shared links")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Every link that can still be opened. Revoking one destroys its wrapped key on the server immediately.")}
      </p>
      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : data && data.shares.length > 0 ? (
          <ShareList shares={data.shares} names={names} />
        ) : (
          <EmptyState
            image="sharing"
            title={t("No active links")}
            actions={
              <Button asChild size="lg">
                <Link to="/drive">{t("Go to my drive")}</Link>
              </Button>
            }
          >
            {t("Share a file from your drive and it will show up here, until it expires or burns.")}
          </EmptyState>
        )}
      </div>
    </div>
  )
}
