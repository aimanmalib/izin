# 0004. Decision step, code ceilings and receipts

Date: 2026-11-10. Status: accepted.

## Context

The decision step runs on SERV Reasoning with Prompt Guard, Shadow Agent and a strict JSON schema. Code then applies fixed
ceilings (S1 to S9) and writes a receipt. Some behaviour was not settled by the specification and needed a rule.

## Decision

- **Fallback ladder.** (a) full request, (b) without Shadow Agent, (c) model without the feature suffix, (d) without
  `response_format`, with JSON asked for in the user message. A rung that got HTTP 400 is remembered for the process, so later
  checks start where SERV accepts the request. A reply that is not a usable decision also moves one rung down, for that check
  only. The rung used is written on the receipt. The reply is checked in code on every rung.
- **Guard refusals are final.** A reply that is not a decision and carries a refusal field, a `content_filter` finish, or one of
  the refusal markers in config counts as a guard refusal. The request is not repeated without the guard; the verdict is ASK.
  The markers are config values because the exact refusal text is measured, not assumed.
- **One retry** on 429 or 5xx after a fixed pause; no retry on time-out, 402 or a missing key.
- **No decision is requested when nothing could be read.** With no document read there are no clauses; the S5 ceiling already
  caps the verdict at ASK, so a call would cost credit without changing anything. The receipt says so (`decider_skipped`).
- **S1 counts the `*` group and the caller's agent token,** not only IzinBot, because the agent that acts is not IzinBot.
- **Content Signals: a "no" in any group that applies wins** (IzinBot, `*`, the caller's agent token).
- **S7 replaces a verdict instead of capping it.** A NO_GO that cites no prohibiting clause and no signal becomes ASK. It is
  the only ceiling that can make a verdict less strict, and only from NO_GO to ASK; GO is never produced by code.
- **Unknown rule ids are dropped** from `rules_applied`; they explain a verdict, they do not make it. Any other field outside
  the schema makes the reply unusable.
- **Receipt hash** = sha256 of canonical JSON (keys sorted at every level, arrays in order) of the receipt without the hash
  field. A stored receipt whose JSON no longer matches its hash is not served.
- **Offline decider for tests.** With `IZIN_FAKE=1` a small rule-based decider answers in the same shape, and a detail field
  that matches a fixture list of injection phrases gets a guard-style refusal. It is never used in production.

## Consequences

Every failure path ends in ASK or NO_GO, and the receipt names the ceiling codes and flags that shaped the verdict. The guard
markers and the ladder start rung are expected to change after the first measured runs against SERV.
