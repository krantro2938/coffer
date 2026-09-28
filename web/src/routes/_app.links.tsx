import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Link2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ShareList } from "@/components/drive-dialogs"
import { useDrive } from "@/lib/drive"

export const Route = createFileRoute("/_app/links")({ component: LinksPage })

function LinksPage() {
  const { data, isLoading } = useDrive()
  const names = useMemo(() => new Map(data?.items.map((i) => [i.id, i]) ?? []), [data])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p className="eyebrow">Active links</p>
      <h1 className="mt-1 text-3xl font-medium">Shared links</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every link that can still be opened. Revoking one destroys its wrapped key on the server immediately.
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
          <div className="grid place-items-center rounded-3xl border border-dashed bg-card/40 px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-lavender-soft text-accent-foreground">
              <Link2Icon className="size-6" />
            </span>
            <p className="mt-5 font-medium">No active links</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Share a file from your drive and it will show up here, until it expires or burns.
            </p>
            <Button asChild className="mt-6">
              <Link to="/drive">Go to my drive</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
