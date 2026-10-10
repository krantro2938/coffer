import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { useIsDesktop } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"

/** A centred dialog on desktop and a bottom sheet on phones. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const desktop = useIsDesktop()
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("grid-cols-[minmax(0,1fr)] gap-5 rounded-2xl p-6 sm:max-w-md", className)}>
          <DialogHeader>
            <DialogTitle className="min-w-0 text-lg font-medium tracking-tight break-words">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          {/* The footer's own margins assume the default padding and radius; match this dialog's. */}
          {footer && <DialogFooter className="-mx-6 -mb-6 rounded-b-2xl px-6">{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="rounded-t-3xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="min-w-0 text-lg font-medium tracking-tight break-words">{title}</DrawerTitle>
          {description && <DrawerDescription>{description}</DrawerDescription>}
        </DrawerHeader>
        <div className="min-w-0 overflow-y-auto px-4 pb-2">{children}</div>
        {footer && <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</DrawerFooter>}
        {!footer && <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" />}
      </DrawerContent>
    </Drawer>
  )
}
