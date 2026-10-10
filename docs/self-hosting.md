# Self-hosting Coffer

Everything is one container: the Go server, the built web app and an embedded SQLite database. All settings are
environment variables; `docker-compose.yml` lists every one with its default, and `.env.example` is a starting point.

## Run

```sh
docker compose up -d                       # http://localhost:8080
DOMAIN=drop.example.com TRUST_PROXY=true HSTS=true docker compose --profile tls up -d   # public, auto-HTTPS
```

Browsers only expose WebCrypto on HTTPS or `localhost`, so serve it over TLS anywhere else.
All settings are environment variables in `docker-compose.yml`.

## Storage

Metadata lives in an embedded **SQLite** file in the `coffer-data` volume; file contents go to an
**S3-compatible bucket**, or to plain files in the same volume when no bucket is configured.

- `coffer.db` — accounts (peppered auth hashes, wrapped master keys, plan), folders and items (encrypted
  names/metadata, wrapped keys), share links (hashed access tokens), sessions.
- File contents — ciphertext only. In a bucket, one object per 4 MB chunk (`<item id>/<chunk>`); locally, one file per
  upload under `blobs/`.
- `server.key` — the server's random pepper.

SQLite in WAL mode is plenty for a single instance; everything in it is ciphertext or hashes.

### Object storage

Any S3-compatible store works. Create a **private** bucket and an access key limited to it, then set:

```sh
S3_BUCKET=my-bucket
S3_ENDPOINT=https://s3.eu-central-1.example.com   # the bucket's S3 endpoint
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

The signing region is read from an endpoint of that shape; set `S3_REGION` for any other.

If more than one deployment uses the bucket (say, production and your laptop), give each its own `S3_PREFIX`
(`prod/`, `dev/`). Each instance removes objects it does not know about, so without prefixes they would delete
each other's files.

Some stores keep old versions of objects, where a plain delete only hides them, so Coffer always deletes by version: a deleted
file is gone from the bucket, not just from view. Leave lifecycle rules off, and do not turn on Object Lock.

### Backups

Every day the server writes a consistent snapshot of the database next to the file contents (`_backup/` in the
bucket, `backups/` on disk) and keeps the last 14. Without the database the ciphertext cannot be decrypted by
anyone, so the two have to be restorable together. To restore: put a snapshot back as `coffer.db`.

`server.key` is **not** in those snapshots on purpose. Keep a copy somewhere else; without it nobody can sign in.

## Accounts and email

With `RESEND_API_KEY` and `MAIL_FROM` set, a new account has to confirm its address with a six-digit code before
it can pay or store anything; sign-ups that never do are removed after a day. With `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`, "Continue with Google" confirms the address instead (authorised redirect URI:
`<PUBLIC_URL>/api/auth/google/callback`). Google only identifies the account: the encryption password is still
chosen by the user and never leaves their browser, and a Google sign-in lands on a locked drive.

## File requests

Nothing to configure. Any account can make upload links from **File requests** in its drive. What comes in counts
against that account's storage, each file is bounded by `MAX_FILE_MB`, and an upload link stops working when its
owner's drive is read-only or suspended. See [the security model](security.md#file-requests) for how the encryption
works.

## Plans and billing

With `PADDLE_API_KEY` set there is no free drive: an account picks a plan (Starter 100 GB, Plus 500 GB, Pro 1 TB,
defined in `server/internal/paddle`) and pays through [Paddle](https://www.paddle.com). Quick shares stay free and
account-less: up to 5 files and 100 MB per share. Without the key, drives are free and sized by `USER_QUOTA_MB`.

1. `PADDLE_API_KEY=... coffer paddle-setup https://coffer.example` creates the products and prices, a
   client-side token and the webhook destination, and prints the `PADDLE_CLIENT_TOKEN` and
   `PADDLE_WEBHOOK_SECRET` lines for your environment. It is safe to run again. Sandbox keys (`pdl_sdbx_…`) talk to
   the sandbox automatically.
2. In the Paddle dashboard, set **Checkout → Checkout settings → Default payment link** to
   `https://coffer.example/pay` (and get the domain approved for live payments).

The checkout page is Coffer's own (order summary, copy, styling); Paddle only draws the payment form inside it,
and how that form looks is set under Checkout settings → Styling in the Paddle dashboard. It is the only
third-party code Coffer ever loads, and it runs on a bare `/pay` page with its own policy. For real separation from the app, give it its own hostname: point `pay.coffer.example` at the same server
and set `PADDLE_CHECKOUT_URL=https://pay.coffer.example/pay` (also as the default payment link) and
`PUBLIC_URL=https://coffer.example`.

Webhooks keep subscriptions current; the server also asks Paddle directly after a checkout and once an hour, so
it works without them (e.g. on localhost). Deleting an account cancels its plan first. Paddle receives the
account's email and the payment details typed into its checkout, nothing else.

When a plan ends the drive turns read-only (download and delete still work) and its share links pause. The owner
is emailed then and again a week before the end of the grace period (`LAPSE_GRACE_DAYS`, 30 by default); after
that the files, folders and links are deleted. The account stays, so they can pick a plan and start again.
Nothing is ever deleted less than a week after the final warning.

## Admin console

With `ADMIN_TOKEN` set (24+ characters) the server opens a second listener on `ADMIN_ADDR` (`:8081`). Put it behind
its own hostname (`admin.coffer.example` → port 8081); none of it is reachable from the public site. Sign in with
the token. From there you can:

- see accounts, what they pay and how much they store (never names or contents, which the server cannot read);
- invite someone by email on agreed terms: complimentary storage with an optional end date, or a personal price
  (amount, monthly or yearly, optional free trial) that they pay through the normal checkout. The invitee sets
  their own password from the emailed link; an admin never handles it;
- change an existing account's terms, suspend it (signs it out, blocks sign-in, pauses its links) or delete it;
- handle abuse reports. Anyone holding a link can report it from the link's page and may hand over the link's key
  so the reviewer can open it. A report can be dismissed, or the link removed, the file deleted, or the account
  suspended. `ADMIN_NOTIFY_EMAIL` gets an email for each new report;
- answer trial requests. With paid plans on, the home page lets a visitor leave an email address to try a drive
  first. Those addresses are listed on the Invitations tab; inviting one with complimentary storage and an end date
  is the trial. `ADMIN_NOTIFY_EMAIL` hears about each new request;
- read the activity log of everything done there.

## Deploying a release

Every commit on `main` that passes its checks is published as a container image:
`ghcr.io/krantro2938/coffer:latest`, and the same image under the commit's short hash. On the server, next to
`docker-compose.yml` and your `.env`:

```sh
docker compose pull && docker compose up -d    # the newest release
COFFER_TAG=103a197 docker compose up -d        # a particular one, or to roll back
```

Put `COFFER_TAG=...` in `.env` to stay on a release until you choose to move. Nothing is built on the server.
To run your own changes instead, `docker compose up -d --build` builds from the checkout.

## Upgrading

The database schema is versioned. A new version of the server applies whatever migrations it is missing when it
starts, including on databases from before migrations existed, so upgrading is replacing the container. Take a copy
of the data volume first if you want a way back: an older server does not understand a newer schema's additions,
though it will run alongside them.
