import { createFileRoute, Link } from "@tanstack/react-router"
import { Clause, LegalPage, Mail } from "@/components/legal"
import { OPERATOR } from "@/lib/contact"

// The server sends the same title and description with the page (server/internal/app/seo.go).
export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: "Data processing agreement — Coffer" },
      {
        name: "description",
        content:
          "The GDPR data processing agreement for businesses that collect personal data from their clients through Coffer. It applies automatically.",
      },
    ],
  }),
  component: Dpa,
})

function Dpa() {
  return (
    <LegalPage
      title="Data processing agreement"
      intro="When you collect documents from your clients through Coffer, you decide what is collected and why, and we store it for you. Under the GDPR that makes you the controller and us your processor, and the law asks for an agreement between us. This is it. It applies automatically, with nothing to sign."
    >
      <Clause title="Who the parties are">
        <p>
          The <strong>controller</strong> is you: the business or professional with a Coffer account who uses it to receive, keep or send
          personal data about other people, such as clients, candidates or tenants.
        </p>
        <p>
          The <strong>processor</strong> is Coffer, run by {OPERATOR}. Write to <Mail /> for anything in this agreement.
        </p>
        <p>
          This agreement is part of the{" "}
          <Link to="/terms" className="underline underline-offset-4">
            terms
          </Link>
          . Where the two disagree about personal data you process through Coffer, this agreement wins. If you need a copy signed by both
          parties for your records, write to us and we will send one.
        </p>
      </Clause>

      <Clause title="What we process, and why">
        <ul>
          <li>
            <strong>Subject matter and purpose:</strong> storing and transmitting the files, notes and messages that you and the people you
            send links to upload, so that you can receive, keep and share them.
          </li>
          <li>
            <strong>Duration:</strong> for as long as you have an account, and then until deletion as described under "When it ends".
          </li>
          <li>
            <strong>People concerned:</strong> whoever your files are about, typically your clients, candidates, tenants, students or staff,
            and the people who upload through your links.
          </li>
          <li>
            <strong>Kinds of data:</strong> whatever you choose to collect. This can include identity documents, financial records and, if
            you collect them, special categories of data such as health records. We cannot see which, because it is encrypted.
          </li>
        </ul>
      </Clause>

      <Clause title="What we can and cannot read">
        <p>
          Files, notes, file names, folder names, request titles and the messages uploaders write are encrypted in the browser before they
          reach us, with keys we do not have. We cannot read them, and so cannot use, disclose or hand them over in readable form, whatever
          we are asked.
        </p>
        <p>
          What we can see is listed in the{" "}
          <Link to="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          : your account's email address, the size and time of each upload, how often a link is opened, and IP addresses in short-lived
          logs. The one exception to the encryption is a share link you create as "short link only" without a password, whose key we hold;
          the app says so when you choose it.
        </p>
      </Clause>

      <Clause title="What we promise">
        <ul>
          <li>We process the data only to provide Coffer to you, as you instruct by using it, and for no purpose of our own.</li>
          <li>
            Anyone who works on Coffer for us is bound to confidentiality. In practice nobody can read your content, because the keys stay
            with you.
          </li>
          <li>
            We keep the security measures described on the{" "}
            <Link to="/security" className="underline underline-offset-4">
              security page
            </Link>{" "}
            in place: end-to-end encryption, encryption in transit, sign-in that never sends your password, rate limits, and the deletion of
            expired data. We do not weaken them without telling you.
          </li>
          <li>
            We help you answer requests from the people your data is about, as far as we can. Since we cannot read the content, you are the
            one who can find, export or delete a specific person's documents; we can delete whole items or your account on request.
          </li>
          <li>
            If we become aware of a breach of the data we hold for you, we tell you without undue delay, and in any case within 48 hours,
            with what we know.
          </li>
          <li>
            We give you the information you need to show that this agreement is being kept, and answer reasonable questions about it. The
            code that does the encryption is open source, so you or an auditor can check it.
          </li>
        </ul>
      </Clause>

      <Clause title="Who else is involved">
        <p>You agree that we use these subprocessors:</p>
        <ul>
          <li>
            <strong>Hetzner Online</strong>, Germany: runs the server, which holds account data and passes encrypted files through.
          </li>
          <li>
            <strong>Backblaze</strong>, in its European Union region: stores the encrypted files. It only ever receives ciphertext.
          </li>
          <li>
            <strong>Resend</strong>, United States: sends our emails, such as sign-in codes and the email telling you files have arrived. It
            receives your email address and the message, never your files. Transfers rely on the European Commission's standard contractual
            clauses.
          </li>
        </ul>
        <p>
          We tell you by email at least 30 days before adding or replacing a subprocessor. If you object, you can close your account before
          the change takes effect. We bind each subprocessor to data protection terms at least as strict as these.
        </p>
      </Clause>

      <Clause title="When it ends">
        <p>
          You can download your files and delete them, or your whole account, at any time. Deleting an account removes its files, folders
          and links from storage straight away; copies of the account database in our backups expire within 14 days. Your files are never in
          our backups in readable form.
        </p>
      </Clause>

      <Clause title="Your side">
        <p>
          You are responsible for having a lawful basis to collect what you collect, for telling the people concerned, and for keeping your
          password and recovery key safe. If both are lost, nobody, including us, can recover the data.
        </p>
      </Clause>
    </LegalPage>
  )
}
