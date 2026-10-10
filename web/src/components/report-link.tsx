import { useState } from "react"
import { toast } from "sonner"
import { FlagIcon, Loader2Icon } from "lucide-react"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OptionPicker } from "@/components/option-picker"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

const REASONS = ["malware", "phishing", "illegal", "copyright", "harassment", "other"]
const reasonOptions = [
  { value: 0, label: "Malware or a virus" },
  { value: 1, label: "Phishing or a scam" },
  { value: 2, label: "Illegal content" },
  { value: 3, label: "Copyright infringement" },
  { value: 4, label: "Harassment or private information" },
  { value: 5, label: "Something else" },
]

/**
 * Lets anyone holding a link report it. We cannot open links ourselves, so the
 * reporter decides whether to hand over the key that lets a reviewer look.
 */
export function ReportLink({ id, secret }: { id: string; secret: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(-1)
  const [details, setDetails] = useState("")
  const [contact, setContact] = useState("")
  const [share, setShare] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (reason < 0) return toast.error(t("Choose what is wrong with this link"))
    setBusy(true)
    try {
      await api(`/api/s/${id}/report`, { body: { reason: REASONS[reason], details, contact, secret: share ? secret : "" } })
      toast.success(t("Report sent. Thank you."))
      setOpen(false)
      setDetails("")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto mt-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <FlagIcon className="size-3.5" /> {t("Report this link")}
      </button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={t("Report this link")}
        description={t("Tell us what is wrong. Coffer cannot read what links contain, so your description is what we act on.")}
      >
        <form onSubmit={submit} className="grid gap-4">
          <OptionPicker
            label="What is wrong?"
            icon={FlagIcon}
            value={reason}
            options={reasonOptions}
            onChange={setReason}
            placeholder="Choose one"
          />
          <div className="grid gap-1.5">
            <Label htmlFor="report-details">{t("What did you find?")}</Label>
            <Textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              minLength={10}
              maxLength={4000}
              required
              className="min-h-28"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-contact">{t("Your email, if we may ask you more (optional)")}</Label>
            <Input id="report-contact" type="email" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={254} />
          </div>
          {secret && (
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border bg-muted/40 p-3">
              <span className="text-sm">
                {t("Let the reviewer open this link")}
                <span className="block text-xs text-muted-foreground">
                  {t("Sends the link's key with your report. Without it we can only act on your description.")}
                </span>
              </span>
              <Switch checked={share} onCheckedChange={setShare} />
            </label>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />} {t("Send report")}
          </Button>
        </form>
      </ResponsiveDialog>
    </>
  )
}
