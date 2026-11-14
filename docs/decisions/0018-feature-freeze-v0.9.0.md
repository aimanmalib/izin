# 0018. Feature freeze at v0.9.0: which checks pass and which do not

Status: accepted

## Context

The product spec lists ten acceptance checks (H1 to H10) to review before the feature freeze. The
freeze is the `v0.9.0` tag. After it, only fixes and text changes go in. This record says where
each check stands at the tag, using what was measured. It does not list targets.

## Status at the tag

| Check | What it asks | Status | Evidence |
|---|---|---|---|
| H1 | End-to-end checks on live sites finish with a receipt, each in 90 s or less | partly | Gallery run: 144 of 144 checks ended with a receipt. The median time was 6.6 s, but the longest took 115.0 s, so the 90 s limit was not met every time (`docs/UKUR.md`, Gallery run) |
| H2 | Zero false GO on the benchmark for the shipped variant | not met | V1 has 3 false GO in 43 cases (A09, B09, B20); V0 has 1 (`docs/UKUR.md`, Benchmark) |
| H3 | Agreement with the recorded Set A decisions is reported as it is | met | 8 of 13, with a reason on each row that differs (`docs/UKUR.md`, Set A) |
| H4 | WebKit iPhone 13 and desktop Chromium: no sideways scroll, no console errors, the flow completes | partly | The Playwright suite in `e2e/` passes against a local build. In production, WebKit logs two stylesheet errors from the content security policy on `/` and `/bench`, still being looked into |
| H5 | The `izin_check` MCP tool works from an MCP client against production | met | `npm run mcp-check -- --base https://izin.sasateguh.com` exits 0 (both tools listed, receipt fetched) |
| H6 | Healthy deploy: health 200, compressed HTML, `no-store` API, uptime monitor | met | `/api/health` 200, `content-encoding: gzip` on `/`, `cache-control: no-store` on the API |
| H7 | Spending guard serves only cached receipts at the cap | met | `tests/api-service.test.ts` (fixed clock) |
| H8 | SSRF targets are refused | met | `tests/kumpul-ssrf.test.ts` |
| H9 | Same keys in `lang/en.json` and `lang/ms.json` | met | `tests/lang.test.ts` |
| H10 | At least 80% of reader tokens served by Dolphin | met | 100% (`docs/UKUR.md`, Reader) |

## Decision

- Tag `v0.9.0` with H1, H2 and H4 not fully met. They are reported here and in `docs/UKUR.md`,
  not hidden.
- H2 is the most serious. A false GO is the error Izin exists to prevent. The code checks still
  apply: a GO needs a valid decision and quotes that the code has verified. The false GO cases are
  named so readers can open them. One of them (B09) is a page that tells AI readers to answer GO,
  so public text does not say that injected text never leads to GO, except for the trap page that
  was tested.
- No new features after the tag. Any fix to the false GO cases counts as a fix: it changes the
  rulebook or the decider settings and is then measured again on the same frozen evidence
  (ADR 0016), with the new numbers in `docs/UKUR.md`.

## Consequences

- The published numbers describe the code at the tag.
- A fix that lowers the false GO count shows up as a new benchmark run, not as an edited table.
