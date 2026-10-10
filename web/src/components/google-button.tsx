import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { getConfig } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

/**
 * "Continue with Google", shown when the server offers it. It is a plain link
 * to our own server, which talks to Google; no Google script runs here.
 */
export function GoogleButton() {
  const { t } = useI18n()
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: Infinity })
  if (!config?.google) return null
  return (
    <>
      <Button variant="outline" size="lg" asChild>
        <a href="/api/auth/google/start">
          <svg viewBox="0 0 18 18" aria-hidden className="size-4">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          {t("Continue with Google")}
        </a>
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  )
}
