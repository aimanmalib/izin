# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.2] - 2026-11-15

### Changed

- An ASK always says what to do next: ask the site when its terms are silent, or read the terms yourself when Izin
  could not.
- Calls from the OpenServ market listing have an hourly allowance of their own, so a paying buyer is not refused
  because of other callers.

## [1.0.1] - 2026-11-15

Small fixes from a review of the public site, before submission.

### Changed

- A site whose robots.txt comment forbids every automated action is read at most once every 30 days, up from 7.
- The form takes a bare domain such as `ebay.com` as https.
- The Walmart purchase check, an ASK with two conditions from Walmart's terms for agents, is a one-click example.
- The front page says a saved answer is reused for 24 hours, which is what the code does.

### Fixed

- The pattern for text addressed to AI readers matched ordinary phrases such as "such as an airline".

## [1.0.0] - 2026-11-15

The version submitted to SERV Hackathon 02. Everything after the v0.9.0 feature freeze is a recorded exception to it.

### Added

- An OpenServ agent with one capability, `check`, sold per call on the OpenServ x402 Agent Market in USDC on Base, with
  the first paid call recorded ([ADR 0023](docs/decisions/0023-openserv-agent-on-the-x402-market.md)).
- An on-chain identity for that listing in the ERC-8004 registry on Base.
- A paid route, `GET /api/paid/check`, that sells a saved answer over x402 on the Base Sepolia testnet. It is off unless a
  receiving address is set ([ADR 0022](docs/decisions/0022-paid-answer-over-x402-testnet.md)).
- A fallback decider: the open model on Dolphin decides when SERV is out of credit or capped, and the receipt says so
  ([ADR 0024](docs/decisions/0024-open-model-decides-when-serv-is-out.md)).
- A repeatability run that reads stored policy documents again on Dolphin and reports how many readings match
  ([docs/UKUR.md](docs/UKUR.md)).
- A link preview card, community files, a changelog and public CI.

### Changed

- A GO is capped at ASK when no clause was quoted from the site's terms (S11,
  [ADR 0021](docs/decisions/0021-go-needs-a-quoted-policy-clause.md)).
- The gallery shows pairs with no valid decision as not decided, and a receipt with no decider call shows a whole cost line.
- The demo video was cut again and now has narration, a quiet music bed and credits on its end card.

## [0.9.0] - 2026-11-14

The feature freeze ([ADR 0018](docs/decisions/0018-feature-freeze-v0.9.0.md)).

### Added

- The check pipeline: a guarded fetcher, a policy collector that obeys robots.txt, a reader on Dolphin, a decider on SERV
  Reasoning with code ceilings, a quote checker, and receipts pinned by hash in SQLite.
- The check API, an MCP tool over Streamable HTTP, a rate window, a spending guard and a job queue.
- The web app in English and Malay: front page, receipt, gallery, benchmark, trap shop, docs and IzinBot pages, with
  browser tests on Chromium and WebKit (iPhone 13).
- Pre-registered benchmark sets, a gallery of real sites, a robots-only baseline and the measurements in
  [docs/UKUR.md](docs/UKUR.md).
- Two more ceilings after a re-measure of the saved run: text addressed to AI readers, and a crawl with a Crawl-delay,
  cap the answer at ASK ([ADR 0020](docs/decisions/0020-two-signal-ceilings-and-remeasure.md)).
- A one-container deploy with rollback, and spending-cap alerts sent once per cap.

[Unreleased]: https://github.com/aimanmalib/izin/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/aimanmalib/izin/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/aimanmalib/izin/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/aimanmalib/izin/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/aimanmalib/izin/releases/tag/v0.9.0
