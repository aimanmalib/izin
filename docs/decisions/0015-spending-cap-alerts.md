# 0015. Spending-cap alerts: once per cap, never from a status read

Status: accepted

## Context

The spending guard sent one `budget_cap` alert per UTC day whenever a cap was reached, and the
check behind `GET /api/health` (`cache_only`) went through the same code path. The uptime monitor
reads that route every few minutes, so a reached cap alerted again in the first minute of every UTC
day and after every restart. For a total cap, which never resets, the text was also wrong: it said
nothing needed doing until the next UTC day.

## Decision

- `BudgetGuard.cap(source)` reports which cap applies (`none`, `day` or `total`, the provider, what
  was spent and the cap) with no side effects. `/api/health` uses it, so a status read never alerts.
  Only `exhausted(source)`, called when a new check would start, alerts.
- The alert is split into `budget_cap_day` and `budget_cap_total`. Both texts (in `lang/en.json` and
  `lang/ms.json`) name the provider, the amount spent, the cap and its config key, and say what to
  do: nothing for a daily cap (it opens again at 00:00 UTC); add credit, raise the total cap and
  deploy for a total cap.
- A daily cap still alerts at most once per UTC day. A total cap alerts once per provider and cap
  value: the sent key is stored in a new `alerts_sent` table (added with `CREATE TABLE IF NOT
  EXISTS`; no existing table changes), so a restart does not resend it, while a raised cap that is
  reached again alerts once more. This follows the usual rule for alerts on a lasting state: send
  on a change of state, not once per period.

## Consequences

- A reached total cap produces one alert, not one a day. Removing the `alerts_sent` rows (or using
  a fresh database) sends it again.
- Rolling back to an earlier release leaves the extra table in place; older code ignores it.

## Verification after release (2026-11-11)

Released as `3dbbd30` while the total cap was reached. Three `GET /api/health` reads returned
`cache_only: true` and logged no alert; the `alerts_sent` table was created next to the existing
tables, and the `budget`, `checks` and `extractions` row counts matched the counts taken before the
release.

Across the next UTC day boundary (checked 2026-11-12 00:10 UTC, same container since release, no
restarts) the uptime monitor kept reading `GET /api/health` with the total cap still reached:
no alert was logged or delivered after the release, and `alerts_sent` held no rows because no new
check was attempted. Row counts in `budget`, `checks` and `extractions` were unchanged.
