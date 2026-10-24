import { createFileRoute, Link } from "@tanstack/react-router"
import { Clause, LegalPage, Mail } from "@/components/legal"
import { OPERATOR } from "@/lib/contact"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — Coffer" },
      { name: "description", content: "What Coffer knows about you, what it cannot know, and who else is involved." },
    ],
  }),
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="Coffer is built so that we cannot read what you store or share. This page says what we do hold, why, who else touches it and how long it is kept."
    >
      <Clause title="Who is responsible">
        <p>
          Coffer is run by {OPERATOR}, who is responsible for the personal data described on this page (the controller, in the words of the
          GDPR). Write to <Mail /> for anything on this page, including the requests under "Your rights".
        </p>
        <p>
          For the files your clients and others send you through Coffer, the roles are the other way round: you are the controller and we
          are your processor, under the{" "}
          <Link to="/dpa" className="underline underline-offset-4">
            data processing agreement
          </Link>
          .
        </p>
      </Clause>

      <Clause title="What we cannot see">
        <p>
          Files, notes, file names, folder names and the keys that unlock them are encrypted in your browser before they reach us. We store
          the result, which is unreadable without your password or the secret in a share link. We do not have your password and cannot reset
          it, recover your files or hand their contents to anyone, because we never hold them in readable form.
        </p>
        <p>
          The one exception is a share link you create as "short link only" without a password: to make such a link work we keep its key, so
          its contents are not end-to-end encrypted. The app says so when you choose it.
        </p>
      </Clause>

      <Clause title="What we hold about an account">
        <ul>
          <li>
            <strong>Your email address</strong>, to sign you in, send codes, tell you about your plan and, unless you turn it off in
            Settings, tell you when files arrive through your links. If you choose to, it is shown on the page of an upload link you make,
            so the person uploading knows who is asking.
          </li>
          <li>
            <strong>Sign-in material</strong>: a hash derived from your password on your device (never the password), and your encryption
            keys in sealed form.
          </li>
          <li>
            <strong>Your encrypted files and folders</strong>, with their sizes, counts and dates. Sizes are how we apply storage limits.
          </li>
          <li>
            <strong>Plan details</strong>: which plan you are on, whether it is paid up, renewal and end dates, and the customer and
            subscription references our payment provider gives us. We never receive your card number.
          </li>
          <li>
            <strong>Sessions</strong>: a hashed token for each device you are signed in on, and when it was created.
          </li>
          <li>
            <strong>Your language</strong>, so emails arrive in it.
          </li>
          <li>
            <strong>If you sign in with Google</strong>: the email address Google confirms and Google's identifier for your account. Nothing
            else from your Google account.
          </li>
        </ul>
      </Clause>

      <Clause title="Quick shares without an account">
        <p>
          A quick share needs no account. We store the encrypted files until the expiry you choose (seven days at most), then delete them.
          The list of shares you made lives only in your browser, sealed with a key that stays there, so that you can cancel them.
        </p>
      </Clause>

      <Clause title="Network data and logs">
        <p>
          We use your IP address in memory to limit repeated attempts (sign-ins, link opening, uploads, reports). The application does not
          write it to its database. Our web server may keep short-lived technical logs for security and troubleshooting.
        </p>
      </Clause>

      <Clause title="Counting visits">
        <p>
          We count visits to our pages and a short list of actions, such as opening a share dialog, making an upload link or pressing a
          button on the home page, with Umami, a tool we host ourselves on our own domain. It sets no cookies and stores nothing in your
          browser, and it is not shared with anyone.
        </p>
        <p>
          It receives the kind of page you are on ("a share link", "the drive", "the home page"), never the address of a link, a file name,
          a key or anything you store. For the public pages it also receives the website that sent you there, with its path. It also
          receives your browser's language and screen size, and, as any server does, your IP address and browser string, from which it works
          out a country, browser and device type and an anonymous visit identifier that changes regularly; it does not keep the address
          itself. Nothing is sent from the admin console or the payment page, and nothing at all when your browser says Do Not Track or
          Global Privacy Control.
        </p>
      </Clause>

      <Clause title="Cookies and browser storage">
        <p>We use no advertising cookies and no third-party trackers. We use only what the app needs to work:</p>
        <ul>
          <li>a session cookie while you are signed in, and short-lived cookies during a Google sign-in;</li>
          <li>a cookie remembering your language;</li>
          <li>
            storage in your browser for your theme, your list of quick shares and, only if you choose "stay unlocked on this device", your
            key in a form that cannot be exported.
          </li>
        </ul>
      </Clause>

      <Clause title="Abuse reports">
        <p>
          If you report a link we keep what you tell us: the reason, your description, your email if you give one, and the link's key if you
          choose to send it so that a reviewer can open the link. We use this only to assess the report.
        </p>
      </Clause>

      <Clause title="Waiting list for paid plans">
        <p>
          If you leave your email on the pricing section we keep it, with your language and when you left it, to send you one email when the
          paid plans open. We use it for nothing else. Write to us to be removed sooner.
        </p>
      </Clause>

      <Clause title="Who else handles your data">
        <ul>
          <li>
            <strong>Backblaze</strong> stores the encrypted files, in the European Union. It only ever receives ciphertext.
          </li>
          <li>
            <strong>Paddle</strong> sells the plans as merchant of record and processes payments. It receives your email address and the
            payment details you enter on its form, and handles tax and invoices under its own privacy policy.
          </li>
          <li>
            <strong>Resend</strong> delivers our emails. It receives your email address and the message.
          </li>
          <li>
            <strong>Google</strong>, only if you choose to sign in with Google.
          </li>
          <li>
            Our <strong>hosting provider</strong> runs the server that holds the account data described above, in Germany.
          </li>
        </ul>
        <p>We do not sell personal data and do not share it for advertising.</p>
      </Clause>

      <Clause title="How long we keep it">
        <ul>
          <li>
            Account data: until you delete your account, which you can do at any time in Settings. Deleting it removes your files, folders,
            links and plan.
          </li>
          <li>A sign-up whose email is never confirmed: removed after one day.</li>
          <li>The waiting list: deleted once the email saying the paid plans are open has gone out.</li>
          <li>
            A drive whose plan has ended: read-only for 30 days, with two warnings by email, then its files, folders and links are deleted.
            The account itself stays until you delete it.
          </li>
          <li>Quick shares: until they expire, are used up, or you cancel them.</li>
          <li>
            Backups: daily copies of the account database are kept for 14 days, so deleted account records can persist in a backup for that
            long. Deleted files are removed from storage straight away.
          </li>
          <li>Abuse reports and the record of what was done about them: kept while they are needed to handle repeat abuse and disputes.</li>
        </ul>
      </Clause>

      <Clause title="Why we are allowed to use it">
        <p>
          We process account and plan data to provide the service you signed up for; network data and abuse reports to keep the service
          secure and lawful, which is our legitimate interest; and billing records as the law requires.
        </p>
      </Clause>

      <Clause title="Your rights">
        <p>
          You can ask for a copy of the personal data we hold about you, have it corrected or deleted, object to how we use it, or ask us to
          restrict it. Write to <Mail />. If you are in the European Economic Area or the United Kingdom you can also complain to your data
          protection authority. Bear in mind that we can only give you what we hold: we cannot decrypt your files for you.
        </p>
      </Clause>

      <Clause title="Requests from authorities">
        <p>
          If we are lawfully required to hand over data, we can only provide what is listed on this page: account details and encrypted
          files that we cannot read.
        </p>
      </Clause>

      <Clause title="Children">
        <p>Accounts are for adults. Coffer is not meant for anyone under 18, and we do not knowingly hold their data.</p>
      </Clause>

      <Clause title="Changes">
        <p>
          If we change this policy in a way that matters we will say so on this page and, for account holders, by email before it takes
          effect.
        </p>
      </Clause>
    </LegalPage>
  )
}
