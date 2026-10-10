# Developing Coffer

```sh
cp .env.example .env    # optional: S3 and Paddle sandbox keys
make install            # once: the web app's dependencies
make server             # API on :8080, reads .env
make web                # UI on :3000, proxies /api
```

## Layout

The server is one Go module under `server/`:

| Package | What it holds |
| --- | --- |
| `cmd/coffer` | the binary: reads the configuration, opens the data directory, serves |
| `internal/app` | the HTTP API, the admin console and the janitor |
| `internal/store` | the database: every query, and the migrations |
| `internal/storage` | where ciphertext is kept: local disk or an S3-compatible bucket |
| `internal/paddle` | the Paddle Billing client and the plans on sale |
| `internal/mail` | the emails, sent through Resend |
| `internal/config`, `internal/ratelimit` | environment settings; request limits |

The schema is versioned with [goose](https://github.com/pressly/goose). Migrations are the numbered SQL files in
`server/internal/store/migrations`, embedded in the binary and applied when it starts; to change the schema, add
the next file. Released migrations are never edited.

## Languages

The web app speaks English, German, Spanish, Dutch, Russian and Chinese. English is the text in the code; each
other language has a folder under `web/src/locales/` whose files mirror the parts of the app:

```
web/src/locales/
  index.ts          the list of languages, and how each is loaded
  en/  de/  es/  nl/  ru/  zh/
    index.ts        plural rule, and the parts below merged
    common.ts  landing.ts  share.ts  auth.ts  drive.ts
    requests.ts  billing.ts  security.ts  errors.ts
```

Every entry is keyed by the English text, so `t("Share link")` needs no key to be invented and a missing entry
falls back to English. Plural entries hold the language's forms separated by `|`, in the order its `plural`
function counts them. A language other than English is fetched only when someone uses it. To add one, copy a
folder, translate the values and list it in `locales/index.ts`. The terms, the privacy policy, the admin console
and the emails are not translated (emails go out in English or Russian).

## Checks

```sh
make check    # formatting, lint and types for both halves, and the Go tests
make e2e      # the web app's crypto and transfer code against a throwaway server
make fmt      # gofmt and oxfmt
```

`make` on its own lists every target. The web app is linted with [oxlint](https://oxc.rs/docs/guide/usage/linter)
and formatted with [oxfmt](https://oxc.rs/docs/guide/usage/formatter); the server with `go vet` and `gofmt`. CI
runs the same targets.

To point the end-to-end tests at a server of your own, set `COFFER_URL` and run
`npx vitest run tests/integration.test.ts --environment node` in `web/`. They expect free drives, so run that
server with `PADDLE_API_KEY=` (empty). To try the Paddle
sandbox checkout locally, open the app as `http://coffer.localhost:8080` and use that origin's `/pay` as the
sandbox default payment link (Paddle does not accept a bare `localhost`).
