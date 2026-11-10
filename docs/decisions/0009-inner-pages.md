# 0009. Inner pages, the trap shop and the benchmark file shape

Status: accepted

## Context

Besides the front page and receipts, the site needs a gallery, a benchmark page, the trap, API and
MCP docs, and a page about IzinBot. The trap must be a page Izin can check like any other site,
with one sentence hidden from people. Numbers on these pages must match what the server enforces.

## Decision

- `/gallery`, `/bench`, `/trap`, `/docs` and `/bot` are routes of the same app. Each reads its data
  from the API (`/api/gallery`, `/api/bench`, `/api/site`); no number is written in the page code.
  `/api/site` now also carries the reader's limits (requests per check, policy pages, pauses,
  days before a refetch) and the API limits, taken from `config/izin.json`.
- The trap shop (`/trap/` and `/trap/terms`) is plain HTML from `fixtures/trap/`, the same files the
  browser tests check. It is served with its own policy: no script, inline styles allowed, so the
  `display:none` sentence stays hidden in a browser while the reader still sees it in the source.
  The `/trap` page checks `web.trap_url` from config, so tests can point it at a local copy.
- The second trap button sends the visitor's own detail. The page does not promise what the guard
  will do; it names the two ceilings (S6, S8) that keep the verdict from becoming GO and links the
  receipt, which lists the ceilings that actually applied.
- The gallery shows each verdict as a colour and a word that opens its receipt. Sites that blocked
  the reader are listed apart, with the reason, and are not retried another way.
- `bench/results.json` has a fixed shape (Set A rows, Set B counts, decision step variants, total
  cost) checked with a schema. A file that does not match is not shown; before the run, `/bench`
  shows only the readability counts and says the run has not happened.

## Consequences

The benchmark run must write `bench/results.json` in this shape. The trap test page lives in
`fixtures/`, so the container image must include that folder.
