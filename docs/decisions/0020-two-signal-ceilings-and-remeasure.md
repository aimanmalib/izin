# 0020. Two more code ceilings, and a re-measure of the saved benchmark

Status: accepted. Extends [ADR 0004](0004-decider-ceilings-receipt.md) (the ceilings).

## Context

Izin's rule is that code has the last word over the decision step: the code ceilings in
`server/putus/siling.ts` can lower a verdict and never raise it. The 14 Nov benchmark run
(`bench/runs/bench.json`) still had false GO answers for the shipped variant, and each of them had
a signal the code already held but did not act on:

- **Text addressed to AI agents.** When a page holds text written to AI agents, Izin sets it aside
  and marks the receipt with S9. Until now S9 only lowered the confidence. The decision step then
  answered GO on two designed cases (B09, B20) whose pages carry such text.
- **Crawl-delay.** A robots.txt `Crawl-delay` asks crawlers to wait between requests. A plain GO
  for a crawl drops that request. Set A pair A09 (a crawl, Crawl-delay 2) was recorded as ASK by
  the source review, and both variants answered GO.

## Decision

- **S9** now caps the final verdict at ASK when text addressed to AI agents was found, with the
  flag `addressed_to_ai`. When it lowers a GO, the receipt adds the condition that a person reads
  the quoted pages first. A NO-GO stays NO-GO.
- **S10** (new) caps a `crawl` at ASK when robots.txt sets a positive Crawl-delay, with the
  condition "wait N seconds between requests", N read from robots.txt. Other actions are not
  affected.
- Both read only the signals (`signalCeilings`), so they apply in the same way to a live check and
  to a saved answer. Unit tests cover each ceiling and check that neither ever raises a verdict.
- The condition texts live in `lang/en.json` and `lang/ms.json`.

## Re-measure

The benchmark is not run again: no site is fetched and no model is called. `npm run remeasure`
takes each saved final verdict from `bench/runs/bench.json`, applies the current ceilings read
from the frozen signals of its pair (`bench/evidence/`), and scores it against the
pre-registered labels. Before adding anything it scores the saved verdicts and stops if that
does not match the saved scores. The result is a new file, `bench/runs/remeasure.json`; the
saved run and the evidence are unchanged. `docs/UKUR.md`, `/bench` and `/trap` read their
numbers from that file.

The counts are in the "Re-measure with the current ceilings" section of
[`docs/UKUR.md`](../UKUR.md).

## Consequences

- A GO now needs the decision step's GO and no AI-addressed text on the pages read. Some GO
  answers that were right become ASK; the re-measure counts them.
- The re-measure covers the 43 benchmark pairs. Gallery receipts already stored keep the verdict
  they were issued with; a new check of the same pair gets the new ceilings.
- Rollback: revert the commit that adds S10 and the S9 cap; the saved run files are untouched.
