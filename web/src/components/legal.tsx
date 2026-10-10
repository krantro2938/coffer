import { Link } from "@tanstack/react-router"
import { SiteFooter, SiteHeader } from "@/components/site-header"
import { LEGAL_UPDATED, SUPPORT_EMAIL } from "@/lib/contact"

/** Page frame for the terms and the privacy policy. They are written in English only. */
export function LegalPage({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main lang="en" className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="text-4xl font-medium sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        <p className="mt-6 text-lg text-pretty text-muted-foreground">{intro}</p>
        <div className="mt-12 grid gap-10">{children}</div>
        <p className="mt-12 rounded-2xl bg-secondary p-5 text-sm text-secondary-foreground">
          Questions about any of this: <Mail />. See also the{" "}
          <Link to="/terms" className="underline underline-offset-4">
            terms
          </Link>
          , the{" "}
          <Link to="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link to="/security" className="underline underline-offset-4">
            how the encryption works
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}

export function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-medium">{title}</h2>
      <div className="mt-3 grid gap-3 text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:grid [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  )
}

export function Mail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-foreground underline underline-offset-4">
      {SUPPORT_EMAIL}
    </a>
  )
}
