# 0021. A GO for crawl, account, purchase or post needs a quoted policy clause

Status: accepted. Tightens the "silence means GO" default of [ADR 0004](0004-decider-ceilings-receipt.md)
for four actions, and extends [ADR 0020](0020-two-signal-ceilings-and-remeasure.md) (the re-measure).

## Context

The decision step may answer GO when nothing it was shown restricts the action. For reading one
public page that default is reasonable. For crawling, creating an account, buying or posting, it
turned out too weak in the gallery:

- On some sites the page Izin found as "terms" was a menu, a footer or a legal index page. It was
  read in full and held no clause about the action, and the decision step answered GO.
- On one site the gallery pointed Izin at a legal index page instead of the terms of service,
  which do prohibit automated access.
- On one site the terms page only renders in a browser. It was found but its text could not be
  read, and because a robots.txt comment had been read the receipt did not report the terms as
  unread.

The README also said that a GO citing nothing becomes ASK, and the code did not do that.

## Decision

- **S11** (new) caps the final verdict at ASK for `crawl`, `account`, `purchase` and `post` when
  no clause sent to the decision step was quoted from a policy document (the site's fetched terms
  or terms the caller pasted). A clause from a robots.txt comment alone does not count. The reason
  on the receipt names what was read, with its size in characters, and says that no clause could
  be quoted, so silence is not taken as permission. `read_page` and `train` keep the earlier rule.
- When there is no clause at all for one of those four actions, the verdict cannot be above ASK
  whatever the decision step says, so no decision is requested and nothing is spent. The receipt
  carries the existing `decider_skipped` flag.
- **S5** now also covers a common terms path that answered with a page Izin cannot read (for
  example one that needs a browser), unless another path was read in full. The receipt lists the
  URL and the reason in plain words from `lang/en.json` and `lang/ms.json`.
- The gallery's policy hint for eventbrite.com now points at its terms of service.
- S11 reads only the signals and the clauses of a check (`signalCeilings`), so it applies in the
  same way to a live check and to a saved answer. Unit tests cover each case and check that S11
  never raises a verdict.

## Re-measure

As in ADR 0020, the benchmark is not run again. `npm run remeasure` applies S9, S10 and S11 to the
saved final verdicts and the frozen evidence of each pair and writes a new file,
`bench/runs/remeasure-s11.json`; the earlier `bench/runs/remeasure.json` is kept as it was saved.
`docs/UKUR.md`, `/bench` and `/trap` read the new file. S11 removes the last false GO of each
variant and lowers one designed case whose expected answer is GO (B07) to ASK, so agreement drops
by one for the shipped variant. The numbers are in `docs/UKUR.md`.

## Consequences

- Fewer GO answers. An ASK names what was read, which tells the operator where to look.
- A site whose terms permit the action in plain words still gets GO, with that clause quoted.
- Undo: revert the S11 lines in `server/putus/siling.ts` and the skip rule in `server/pipeline.ts`;
  saved receipts are not changed either way.
