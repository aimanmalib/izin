# Contributing

Thanks for helping. Izin tells an agent whether a site allows an action, so a change to how a verdict is made gets extra
scrutiny: it needs a test and a written decision.

## Set up

Node.js 22 (see `.nvmrc`) and npm.

```sh
npm ci
npm run gate                 # lint, type check, unit tests, build, browser tests
IZIN_FAKE=1 npm start        # http://localhost:8080 with recorded fixtures: no keys, no model calls
```

The unit tests make no network calls. The browser tests run on Chromium and WebKit (iPhone 13).

## Before you open a pull request

- Run `npm run gate`; CI runs the same script.
- Values such as actions, limits, prices and caps live in [`config/izin.json`](config/izin.json). Code reads them and
  does not keep its own copies.
- Text a user reads goes in [`lang/en.json`](lang/en.json) and [`lang/ms.json`](lang/ms.json), with the same keys.
- A change to how a verdict is made (the reader, the decider, a ceiling) needs a test that fails without your change
  and a record in [`docs/decisions/`](docs/decisions/).
- Stored receipts are pinned by hash. Do not edit one; add a new check.
- IzinBot obeys robots.txt and does not try to get past a block or a challenge. A change that would is declined.
- One topic per pull request; describe how you tested it.

## Reporting security issues

Please don't open a public issue. Use
[private vulnerability reporting](https://github.com/aimanmalib/izin/security/advisories/new).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) and that you follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
