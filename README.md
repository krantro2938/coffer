# Coffer

End-to-end encrypted file & text sharing with an optional private drive.
Go backend · TanStack Start + shadcn/ui frontend · one container.

## Run

```sh
docker compose up -d                       # http://localhost:8080
DOMAIN=drop.example.com TRUST_PROXY=true HSTS=true docker compose --profile tls up -d   # public, auto-HTTPS
```

Browsers only expose WebCrypto on HTTPS or `localhost`, so serve it over TLS anywhere else.
All settings are environment variables in `docker-compose.yml`. Data lives in the `coffer-data` volume
(`coffer.db`, `blobs/`, and `server.key` — back up all three together).

## How it's secured

- Files and notes are encrypted in the browser (AES-256-GCM, 4 MB chunks, per-file random keys). The
  server stores only ciphertext; names, types and sizes are encrypted too.
- Share links look like `/s/k7m3xq2#h4c9w2pz8rtf6mxn`. The fragment is an 80-bit secret the server never
  sees. Optional passwords are mixed in via Argon2id. The server keeps only a hash of a derived access token.
- Links can expire, burn after N views, and be revoked. Wrong passwords never consume a view.
- Accounts: the password is stretched with Argon2id on the device. It unwraps a random master key; the
  server gets a peppered hash of a derived auth key. A recovery key is issued at sign-up.
- Hardening: strict CSP with hashed inline scripts, HttpOnly SameSite=Strict cookies, CSRF header checks,
  rate limits, read-only non-root distroless container, janitor purging expired data every minute.

## Develop

```sh
cd server && DATA_DIR=./data go run .      # API on :8080
cd web && npm i && npm run dev             # UI on :3000, proxies /api
COFFER_URL=http://127.0.0.1:8080 npx vitest run tests/integration.test.ts --environment node
```
