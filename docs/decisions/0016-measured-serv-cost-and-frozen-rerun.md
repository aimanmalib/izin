# 0016. Measured SERV cost per decision, and benchmark reruns on frozen evidence

Status: accepted. Superseded in part by [ADR 0019](0019-serv-cost-from-console-balance.md) (the factor value).

## Context

The spending guard prices a SERV decision as listed token price times `serv_cost_factor`. The
factor was set to 3 before any paid run. The first paid runs used the whole SERV credit while the
guard had counted far less: a decision with Prompt Guard, Shadow Agent and schema repair bills more
components than the upstream tokens (SERV usage docs list them). Dividing the credit used by the
decisions it paid for gave about USD 0.12 per decision, roughly 170 times the listed token price of
the default per-decision token estimate in `config/bench.json`.

The benchmark (ADR 0014) also needs to rerun decider variants after the credit is topped up. The
first run already froze each case's decider message in `bench/evidence/`. Reading the sites again
would cost reader tokens, could see changed pages, and would fetch pre-registered sites a second
time for no new information.

## Decision

- `budget.serv_cost_factor` is set to the measured ratio (170), so a pre-run estimate and the guard
  both count SERV at about the real cost. `budget.serv_usd_total` is raised by the added credit; the
  ledger rows already recorded stay as they are.
- `bench --from-evidence <dir>` loads one evidence file per pre-registered case, checks that it
  matches the case (id, set, site, action, expected verdict) and decides on that message only. No
  site is fetched and no reader is called. The pre-run estimate counts only the cases that reach the
  decider. These cases keep no receipt, since the full collected pages are not part of the frozen
  evidence. The ceilings are applied to each answer from the frozen signals, as in a live run.

## Consequences

- With the measured factor the daily SERV cap allows only a few new public checks a day; saved
  receipts are still served when it is reached.
- A frozen rerun scores variants on exactly the messages the earlier variants saw. Set A rows of a
  frozen rerun link no receipt.
- Undo: set the factor and cap back in `config/izin.json`; the `--from-evidence` flag is opt-in.
