# Contributing to Coffer

Thanks for looking. Coffer is small enough to read in an afternoon, and contributions of every size are welcome:
a typo, a translation, a bug report, a feature.

## Before you write code

- **A bug or a small fix:** open a pull request directly.
- **Something larger, or a change to how the encryption works:** open an issue or a
  [discussion](https://github.com/krantro2938/coffer/discussions) first, so nobody builds something that cannot be
  merged. Anything that touches keys, links or what the server is allowed to see gets a careful review.
- **A security problem:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Getting it running

You need Go 1.27, Node 24 and `make`.

```sh
make install    # once: the web app's dependencies
make server     # API on :8080
make web        # UI on :3000, proxying /api to the server
```

No configuration is needed for local work: files go to a `data/` directory, drives are free and email addresses
are not verified. [docs/development.md](docs/development.md) explains how the code is laid out.

## Before you open a pull request

```sh
make fmt      # gofmt and oxfmt
make check    # formatting, lint, types, and the Go tests
make e2e      # the web app's crypto and transfer code against a real server
```

CI runs the same three. A pull request that changes behaviour should come with a test that would have failed
before it: the Go tests in `server/internal/app` and `server/internal/store` drive the server the way a browser
does, and `web/tests/integration.test.ts` exercises the real cryptography end to end.

## What a good change looks like

- **It reads like the code around it.** Comments say why, not what. Names are plain words.
- **The server stays ignorant.** It stores ciphertext, wrapped keys and hashes. If a change would have it see a
  file name, a key or a link secret, that is a design change: say so in the pull request.
- **No new cryptographic constructions.** Coffer uses WebCrypto's AES-GCM, HKDF and ECDH, and Argon2id. Combine
  those; do not invent.
- **Few dependencies.** The server has two. A new one needs a reason.
- **Schema changes are a new migration**, the next numbered file in `server/internal/store/migrations`. Released
  migrations are never edited.
- **Text in the interface is English in the code**, wrapped in `t("…")`. Add the same key to each language under
  `web/src/locales/`; if you cannot translate one, leave it out and it falls back to English.

## Translations

Corrections from native speakers are especially welcome: German, Spanish, Dutch and Chinese were written without
one. Each language is a folder under `web/src/locales/`, with files that mirror the parts of the app. To add a
language, copy a folder, translate the values and list it in `web/src/locales/index.ts`.

## Licence

Coffer is licensed under the [GNU Affero General Public License v3](LICENSE). By contributing you agree that your
contribution is licensed under the same terms.
