# 0017. Shipped decider variant: the best measured SERV variant

Status: accepted

## Context

The decider variants of the benchmark (ADR 0014) are compared on the same frozen evidence. The rule
for the one that ships: fewest false GO, then most agreement, then lowest cost, and only a SERV
variant ships. V0 (Dolphin only) is measured as the reference.

On 10 Nov only V0 got valid answers; every SERV variant hit an empty credit. After the credit was
topped up, V1 (`gpt-6-luna` with Prompt Guard, Shadow Agent and a strict schema) was decided on the
frozen evidence (ADR 0016). V2 and V3 were not run again, so they have no numbers.

## Decision

- The decider in `config/izin.json` is `gpt-6-luna`, the only SERV variant with measured numbers.
  The configuration that was there before (`gpt-6-luna-serv-multipath`) had never been measured.
- `docs/UKUR.md` reports V0 and V1 side by side as generated, including that V1 has more false GO
  than V0 on this small set, and names the cases.

## Consequences

- What runs in production is the configuration the published numbers describe.
- A later run of V2 or V3 on the same evidence can change the choice with the same rule; the change
  is one value in config.
