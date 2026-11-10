# 0001. Reader, decider, ceilings

Date: 2026-11-10. Status: accepted.

## Context

Izin turns a site's robots.txt and policy pages into a verdict (GO, ASK or NO-GO) for one agent action. Policy pages are long,
and almost all of the tokens in a check are spent reading them. The judgement itself is short. Web text is untrusted: it can
contain hidden sentences aimed at AI systems, and a model can invent a quote that sounds right.

## Decision

Split every check into three parts with different owners.

- **Reader: an open-weights model on Dolphin.** It extracts candidate clauses with their exact wording. Reading is the expensive,
  high-volume step, so it runs on the cheapest capable model, and open weights mean the reading step can be repeated by anyone.
- **Decider: SERV Reasoning.** It receives the verified clauses and returns a verdict in a strict JSON schema. This is the step
  that needs careful reasoning over branching rules, and it is where Prompt Guard and Shadow Agent add value.
- **Ceilings: plain code.** Code verifies every quote as an exact substring of the fetched text, quarantines sentences addressed to
  AI systems, applies hard signals (robots.txt rules, blocks, `ai-input=no`), and keeps the strictest outcome. Any failure along
  the way yields ASK, never GO.

## Consequences

- A verdict can always be traced to quoted text and a fetch record.
- If the Dolphin reader is unavailable, a SERV model reads instead, and the receipt records which reader ran.
- The model proposes, the code decides: a model error can make Izin more cautious, but not more permissive.
