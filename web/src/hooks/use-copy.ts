import { useCallback, useState } from "react"
import { toast } from "sonner"
import { t } from "@/lib/i18n"

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback(async (text: string, label = t("Copied to clipboard")) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      toast.success(label)
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1600)
    } catch {
      toast.error(t("Couldn't access the clipboard"))
    }
  }, [])
  return { copy, copied }
}
