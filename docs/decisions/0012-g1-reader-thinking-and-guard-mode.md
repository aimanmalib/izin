# 0012. G1: reader thinking off, Prompt Guard only on flagged payloads

Status: accepted

## Context

`scripts/g1.ts` measures the reader and the decision step against live providers before the gallery
and benchmark runs (results in `docs/UKUR-G1.md`). Two results of the first run changed config:

- With thinking on, the Dolphin reader spent its whole `max_tokens` budget (6,000) on reasoning for
  three of the five real policy pages and returned no JSON, after 50 to 70 seconds each. The other
  pages took up to 32 seconds.
- With `serv_prompt_guard` declared on every decider request, SERV refused most normal payloads:
  17 of 20 in the first run, 8 of 10 in the second. A refusal comes back as HTTP 200 with
  `message.refusal` set, empty content, `finish_reason` `stop` and zero usage, so the model is not
  called. Payloads without any clause were refused too, so the cause is not the policy text itself.

## Decision

- The reader sends `reasoning_effort: "none"` (config `reader.primary.reasoning_effort`), which turns
  thinking off on this model, and `reader.max_tokens` is 12,000. In the second run every document
  returned JSON on the first call, 95% of returned quotes were found word for word, and the median
  read took under 5 seconds.
- `decider.guard` is `flagged`: the guard is declared only when the code filter
  (`injection_patterns`) flags the operator's detail or a clause that reaches the decider. This is
  the fallback the gate defines for more than one false positive in ten. A guard refusal still ends
  in ASK, and the receipt records whether the guard was declared (`decider.prompt_guard`).
- The code filter gained two patterns aimed at the detail channel: "ignore your rules" style
  wording and an instruction to return a verdict.
- Guard refusals are detected from `message.refusal`, as measured. No Shadow Agent "exhausted"
  marker appeared in the run; the existing marker check stays and is unverified.

## Consequences

- An injection that the code filter does not recognise reaches the decider without the guard. The
  rulebook (R2, R9) and the code ceilings still apply: a detail can never override a quoted
  prohibition, and GO always needs a valid decision.
- Setting `decider.guard` back to `always` restores the earlier behaviour. Removing
  `reasoning_effort` from the reader config turns thinking back on.
