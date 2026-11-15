# 0024. An open model decides when SERV is out of credit or capped

Status: accepted. A third exception to the feature freeze of [ADR 0018](0018-feature-freeze-v0.9.0.md),
added on 15 Nov 2026 before submission.

## Context

The public instance pays for each SERV decision from a small credit, guarded by a daily and a
total cap. When a cap was reached, or SERV answered that the credit was gone, a new check was
refused and the page said that checks were paused. A visitor who arrives then cannot try the
product at all. The benchmark already has a second decider: variant V0, the open model on Dolphin
with no SERV features. On the 43 benchmark pairs, with the current code ceilings, it agrees with
the expected answer on 36, with no false GO and one false NO-GO ([`docs/UKUR.md`](../UKUR.md)).

## Decision

- `decider.fallback_variant` in `config/izin.json` names the benchmark variant that decides when
  SERV cannot: the SERV cap for the check's source is reached, or SERV answers the request with
  "no credit". Null turns this off and such checks are refused as before.
- The fallback gets the same message and the same rulebook prompt. Shadow Agent and Prompt Guard
  are SERV features and do not run. The code ceilings run exactly as for any other check, so they
  still have the last word.
- The receipt carries `decider.fallback: true` and names the model, and the page says in words
  that SERV Reasoning was out of credit or capped. A fallback decision is never presented as a
  SERV decision.
- Its cost is booked to the Dolphin budget at the listed price. A reached Dolphin cap still stops
  new checks, since then nothing can be read either. The operator is alerted about the SERV cap
  as before.

## What was checked

- Unit tests: past the SERV cap the check runs and the receipt is marked; a "no credit" answer
  from SERV falls through to the fallback; with the fallback off the old refusal stands; a
  reached Dolphin cap still refuses (`tests/api-service.test.ts`).
- One live check on 15 Nov 2026 in a local process with the SERV cap reached on purpose:
  `booking.com`, `purchase`, answered NO-GO with the site's clause quoted, marked as a fallback,
  with nothing booked to SERV.

## Consequences

- The demo keeps answering new checks when the SERV credit runs out. SERV stays the decider
  whenever it is available.
- A fallback decision has no Shadow Agent audit and no Prompt Guard. The ceilings that cap a
  verdict on text addressed to AI readers and on a missing policy clause do not depend on either.
- Undo: set `decider.fallback_variant` to null.
