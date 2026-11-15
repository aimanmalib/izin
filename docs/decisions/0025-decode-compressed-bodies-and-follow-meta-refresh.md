# 0025. Decode compressed bodies and follow a meta refresh

Status: accepted. A fix to the collector of [ADR 0002](0002-collector-rules.md), made on
15 Nov 2026.

## Context

Two pages that IzinBot was allowed to fetch were not read the way a browser reads them. Both were
measured on 15 Nov 2026 with the reader's own request headers.

- **A compressed body was read as raw bytes.** IzinBot sends no `Accept-Encoding` header, yet
  `https://www.amazon.com/` answered `content-encoding: gzip` on 6 of 6 tries (about 220 kB on
  the wire, 617 kB decoded). The collector read those bytes as text, found no links on the home
  page, and so found no policy page.
- **A redirect written in HTML was taken for the page.**
  `https://www.google.com/intl/en/policies/terms/` answers 200 with a page of 1,369 bytes. It
  holds a script, a link and, inside `<noscript>`,
  `<meta content="0; URL=https://policies.google.com/terms" http-equiv="refresh">`. The target is
  static HTML that IzinBot may fetch. The collector reported the stub as a policy page that
  needs a browser.

## Decision

- **Bodies are decoded before anything reads them.** `gzip`, `x-gzip`, `deflate` and `br` are
  decoded with Node zlib. The request does not change: IzinBot still sends no `Accept-Encoding`.
  A body with another coding, or with several stacked, is left as it arrived.
- **The size cap holds twice.** `limits.response_max_bytes` applies to the bytes received, as
  before, and again to the bytes they decode to, so a small compressed body cannot grow without
  bound. Past the cap the page is `too_large`. A stream that is not valid for its coding ends in
  the `error` state with the note `content-encoding <name>`. The HTTP status is looked at before
  that, so a blocked or missing page is still reported as blocked or missing. Size and hash in
  the fetch ledger describe the decoded body.
- **A meta refresh on a short page is followed like a redirect.** When an HTML page has less
  visible text than `limits.doc_text_min_chars` and a `<meta http-equiv="refresh">` that names a
  target with a wait of at most `limits.meta_refresh_max_seconds` (5), the collector reads the
  target in its place. This holds for the input page, the home page and policy pages, not for
  robots.txt. The page is parsed as a client without scripting sees it, so a refresh inside
  `<noscript>` counts: IzinBot runs no scripts.
- **The target is a page like any other.** It goes through the same path: the robots.txt of its
  host, the do-not-fetch list, the address guard, the request budget and the pause between
  requests to one host. It uses one request of the budget. The ledger keeps a line for the stub
  (with the note `meta refresh`) and a line for the target.
- **Limits on following.** The target must be on the stub's own registrable domain (an IP
  address matches itself and nothing else), must not be the stub, and must not be a page already
  asked for in the same check. At most `limits.meta_refresh_hops` (1) steps are followed.
- **When Izin does not request the target, nothing changes.** A target on another site, a
  robots.txt disallow, a spent budget or a refused address leave the stub as the page, reported
  as before: a policy stub is `needs_browser`. A target that Izin declined still gets its ledger
  line. Once the target was requested, its answer stands in for the stub, as with an HTTP
  redirect: a block is reported as a block, at the target's URL.

## What was checked

- Unit tests on synthetic sites, no outside network (`tests/kumpul-coding.test.ts`,
  `tests/kumpul-refresh.test.ts`): gzip, x-gzip, br and deflate bodies are decoded, with size and
  hash of the decoded body in the ledger; a body under the cap on the wire and over it decoded is
  `too_large`; a cut-short gzip stream and a body that is not brotli end in `error`; a compressed
  challenge page is seen as a block; a refresh to the same site is followed and the target's text
  becomes the document; a refresh to another registrable domain is not followed; a target that
  robots.txt disallows is not fetched; the hop limit and the request budget hold; a refresh on a
  page with enough text, with a long wait, to itself or to a page already fetched is left alone.
- With decoding and following switched off in a scratch copy, 16 of these tests fail.
- One run of the collector alone (no model call) per URL on 15 Nov 2026:
  - `https://www.google.com/intl/en/policies/terms/`: the stub is in the ledger (1,369 bytes),
    `policies.google.com/robots.txt` answered 404 (no rules), and `policies.google.com/terms` was
    read: 29,582 characters of text, nothing reported as unreadable.
  - `https://www.amazon.com/`: the home page decoded to 1,386,506 bytes and a policy link in its
    footer was found (`/gp/help/customer/display.html?nodeId=508088`). That page answered 403 to
    IzinBot and is reported as blocked. It was not tried another way.

## Consequences

- Sites that compress without being asked are read. A site that blocks the reader on its policy
  page is still a blocked site; decoding the home page changes what Izin can say about it, not
  the answer.
- Following a refresh costs one request, and one more for robots.txt when the target is on a
  host not yet seen in the check. Both come out of the same request budget.
- A page that names a coding it did not apply now ends in `error`, where its bytes were read
  before. A browser fails on such a page too.
- A `<noscript>` refresh can lead to a notice about scripts. A short notice is reported as
  `needs_browser` at its own URL, as the stub was.
- Undo: set `limits.meta_refresh_hops` to 0 in `config/izin.json` and no refresh is followed.
  Decoding has no switch; to remove it, revert the commit that added `server/kumpul/coding.ts`.
