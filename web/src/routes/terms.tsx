import { createFileRoute, Link } from "@tanstack/react-router"
import { Clause, LegalPage, Mail } from "@/components/legal"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms of service — Coffer" }, { name: "description", content: "The terms on which Coffer is offered." }],
  }),
  component: Terms,
})

function Terms() {
  return (
    <LegalPage
      title="Terms of service"
      intro="These are the terms for using Coffer: end-to-end encrypted file sharing, and paid private drives. By using it you agree to them."
    >
      <Clause title="The service">
        <p>
          Coffer lets you share files and notes through links (a "quick share", which needs no account) and keep them in a private drive
          (which needs an account and a plan). Everything is encrypted in your browser; see{" "}
          <Link to="/security" className="underline underline-offset-4">
            how the encryption works
          </Link>
          .
        </p>
      </Clause>

      <Clause title="Your account, your password, your keys">
        <p>
          You need a working email address to open an account, and you must be at least 18. You are responsible for what happens under your
          account and for keeping your password and recovery key safe.
        </p>
        <p>
          <strong>We cannot reset your password or recover your files.</strong> Your password unlocks your keys and never leaves your
          device. If you lose both your password and your recovery key, what you stored is gone for good, and nobody, including us, can get
          it back.
        </p>
      </Clause>

      <Clause title="Plans and payment">
        <ul>
          <li>
            A drive is a subscription. Prices and storage sizes are shown before you pay, and prices include the taxes shown at checkout.
          </li>
          <li>
            Our order process is conducted by our online reseller <strong>Paddle.com</strong>, the merchant of record for all orders. Paddle
            handles payment, invoices, tax and payment-related questions.
          </li>
          <li>
            A plan renews automatically each period until you cancel. You can cancel at any time in Settings; your drive then stays open
            until the end of the period you have paid for.
          </li>
          <li>If you move to a different plan, the difference for the rest of the period is charged or credited at once.</li>
          <li>
            If we change the price of your plan we will tell you by email at least 7 days ahead. The new price applies from your first
            renewal after that notice, never to a period you have already paid for, so you can always cancel first.
          </li>
          <li>
            Some accounts are opened by invitation on terms agreed with us, such as a personal price, a free trial or storage at no charge
            for a time. Those terms apply in place of the listed plans.
          </li>
        </ul>
      </Clause>

      <Clause title="Refunds">
        <p>
          You can cancel within 14 days of your first payment and get it back in full: write to <Mail /> or ask Paddle directly. This is the
          withdrawal period consumer law gives you and that Paddle, as the seller of record, applies to every order. Renewals and periods
          already begun are not refunded, except where the law gives you that right. Refunds are issued through Paddle.
        </p>
      </Clause>

      <Clause title="When a plan ends">
        <p>
          If your plan ends, through cancellation or a payment that does not go through, your drive becomes read-only and your share links
          stop working. You can still download and delete your files. We email you when this happens and again a week before the end of a
          30-day grace period. After that the files, folders and links in the drive are permanently deleted. Your account remains, and you
          can pick a plan and start again.
        </p>
      </Clause>

      <Clause title="Quick shares">
        <p>
          Quick shares are free, limited in size and number of files, and temporary: they are deleted when they expire, are used up, or are
          cancelled. Do not rely on a quick share as the only copy of anything.
        </p>
      </Clause>

      <Clause title="What you may not do">
        <p>You may not use Coffer to store or share:</p>
        <ul>
          <li>malware, or anything meant to damage or break into systems;</li>
          <li>phishing, scams or other fraud;</li>
          <li>material that sexually exploits children, or any other content that is illegal to possess or distribute;</li>
          <li>content that infringes someone else's copyright or other rights;</li>
          <li>other people's private information shared to harass or harm them.</li>
        </ul>
        <p>You may also not try to disrupt the service, get around its limits, resell it without our agreement, or use it to send spam.</p>
      </Clause>

      <Clause title="Reports and enforcement">
        <p>
          We cannot look inside what is stored. Anyone holding a link can report it from the link's page, and may give us the link's key so
          that we can review it. Rights holders and authorities can also write to <Mail />. When a report is credible we may remove the
          link, delete the file, or suspend or close the account behind it, without notice where the matter is serious. If you think we got
          it wrong, write to us and we will look again.
        </p>
      </Clause>

      <Clause title="Your content">
        <p>
          What you store remains yours. You give us only the permission needed to store and transmit it, in encrypted form, as the service
          requires.
        </p>
      </Clause>

      <Clause title="Availability and your own copies">
        <p>
          We work to keep Coffer available and your data intact, but we do not promise uninterrupted service, and no storage is immune to
          failure. Keep your own copy of anything you cannot afford to lose.
        </p>
      </Clause>

      <Clause title="Closing an account">
        <p>
          You can delete your account at any time in Settings; this cancels your plan and permanently deletes everything in it. We may
          suspend or close an account that breaks these terms. If we stop offering Coffer altogether we will give paying customers at least
          30 days' notice to download their files and will refund any period paid for but not provided.
        </p>
      </Clause>

      <Clause title="Liability">
        <p>
          Coffer is provided as it is. To the extent the law allows, we are not liable for indirect or consequential loss, or for data lost
          because a password and recovery key were lost, and our total liability to you is limited to what you paid us in the 12 months
          before the claim. Nothing here limits rights that the law says cannot be limited, including your rights as a consumer.
        </p>
      </Clause>

      <Clause title="Changes to these terms">
        <p>
          We may update these terms. If a change matters we will tell account holders by email at least 7 days before it applies. If you do
          not agree, you can cancel before then.
        </p>
      </Clause>

      <Clause title="Contact">
        <p>
          For support, privacy requests and reports: <Mail />.
        </p>
      </Clause>
    </LegalPage>
  )
}
