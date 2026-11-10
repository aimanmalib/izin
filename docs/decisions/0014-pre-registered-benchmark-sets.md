# 0014. Pre-registered benchmark sets

Status: accepted

## Context

A benchmark that labels its cases after seeing the tool's answers measures nothing. Izin's
benchmark has three sets, and each set's expected answers must exist in the git history before
the first decision run, so anyone can check the order of commits.

## Decision

- `bench/manual.json` (Set A): decisions recorded by a 5 Nov 2026 source review (run by a coding
  agent under the owner's rules) about whether an automated reader may collect a site's competition
  listings (action `crawl`). Each recorded outcome is mapped to a verdict with the mapping stored in
  the file: a prohibition is NO-GO, no prohibition found is GO, unreadable terms or a condition
  (official API, rate limit, other terms) is ASK. Hosts on Izin's do-not-fetch list are never
  fetched: their pairs are marked `paste_recorded` (the recorded quote is pasted) or `not_fetched`.
  Every other site is read once for the benchmark and its evidence is frozen after that read.
- `bench/labeled.json` (Set B): 20 synthetic policies, one rule of the decision rulebook (R1 to R10)
  or one machine-readable signal each (robots.txt comments, `ai-input=no`, `ai-train=no`,
  `Disallow`, hidden text, reader-addressed text). The expected verdict comes from the rulebook. A
  case may list `also_acceptable` verdicts only where the rule itself allows a choice, and those must
  be stricter than the expected one, so a GO is never excused. The label says whether the owner
  reviewed the labels.
- `bench/spot.json`: up to 10 real gallery pairs labelled from the quoted text before any decision
  run. The text was read with IzinBot only (robots.txt and the policy pages the gallery names); no
  model was called.
- `server/bench/sets.ts` holds the shapes and builds each synthetic case as a small site
  (`robots.txt`, a home page, a terms page), so the benchmark run and the tests read the same thing.
  The tests check that the collector sees each case as intended without calling a model.
- The gallery's `policy_hints` stay as the readability run measured them with IzinBot. Hints that
  were tested only with a browser user agent are not added, because a hint that IzinBot cannot read
  would turn a readable site into a blocked one.

## Consequences

- False GO is reported per set: "0 of N on designed cases; X of Y on pre-registered spot checks".
- A disagreement on Set A is explained one line each in the measurement report; labels are not
  changed after a run. A label found wrong later is fixed in a new commit that says so.
