# 0019. SERV cost factor calibrated from the console balance

Status: accepted. Supersedes in part [ADR 0016](0016-measured-serv-cost-and-frozen-rerun.md) (the factor value).

## Context

The spending guard prices a SERV decision as listed token price times `budget.serv_cost_factor`.
ADR 0016 set the factor to 170, measured on the 10 Nov runs. Those runs called the decider with
Multipath (`gpt-6-luna-serv-multipath`), which bills more than the decider shipped since 14 Nov
(`gpt-6-luna` with Shadow Agent and the schema, no Multipath; ADR 0017). With 170 every public
cost figure for the shipped decider was about four times too high.

The SERV console balance gives a direct reading. It was USD 5.01 just after a credit top-up was
applied (14 Nov 11:44 UTC) and USD 4.55 at 15:20 UTC: USD 0.46 spent in between. No other SERV
call ran in that window.

## Calculation

The guard's ledger (`budget` table, 14 Nov row) holds every SERV call made in that window, each
priced at listed token price times 170:

- 35 answers of the benchmark run V1 (frozen evidence) and 2 prime receipts with a decision.
  SERV ledger total USD 2.0172; at factor 1 that is USD 0.011866 of listed token price. The two
  prime receipts alone used 2,384 input and 394 output tokens. The benchmark run kept its priced
  total, not the tokens of each answer.
- 1 benchmark call timed out with no usage returned, so the ledger holds nothing for it. It is
  counted as free here; if it was billed like an average answer the factor would be about 38.

Factor = 0.46 / 0.011866 = 38.8, rounded to **39**. One shipped decision then costs about
USD 0.012 (V1 benchmark: USD 0.0122 a decision).

## Decision

- `budget.serv_cost_factor` 170 -> 39.
- The ledger rows already recorded are not rewritten. `budget.serv_usd_total` is set so the guard's
  remaining SERV budget matches the console balance less a USD 0.50 reserve: ledger total USD
  6.0172, cap USD 10.07, remaining USD 4.05 (it was USD 2.98 before). The daily cap is unchanged;
  at the new factor it allows about 47 decisions a day.
- The saved benchmark run is not rerun and its files are not rewritten. `/bench` and
  `docs/UKUR.md` price its SERV costs again with the current factor: a SERV estimate is linear in
  the factor, so the run-time figure is scaled by 39 / 170 (`config/bench.json`
  `serv_cost_factor_of_saved_run` records 170). The run-time figures stay visible, labelled.
- The front page average is already priced from each receipt's tokens with the current factor.

## Consequences

- At the new factor a SERV decision costs about 380 times a Dolphin-only decision, not 1,600.
- The factor is a reading of one window of 37 billed calls; a later window may differ. Calibrate
  again from the console when the decider configuration changes.
- Undo: set `serv_cost_factor` back to 170 and `serv_usd_total` to 9.0 in `config/izin.json`.
