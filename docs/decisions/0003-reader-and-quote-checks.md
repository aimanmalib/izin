# 0003. How documents are read and how quotes are checked

Date: 2026-11-10. Status: accepted.

## Context

A model reads each policy document and returns clauses with quotes. The verdict is only as good as those quotes, and the
reader is a third-party service that can be slow, out of credit, or wrong. A few cases are not settled by the specification
and needed a rule.

## Decision

- **Primary reader streams.** Dolphin is called with streaming and usage reporting, so long documents do not hit proxy time
  limits, and the receipt can show time to first token, reasoning chunks and the real token count.
- **Fallback is SERV, for any failure of the primary.** Out of credit, server error, timeout, no valid JSON after one retry,
  and also other HTTP errors (401, 404) or a missing key: an unread document weakens the answer more than a different reader.
  The receipt names the reader and the reason. A reply from a different model than requested, or a response header that names
  a relay, is marked `fallback_suspected`.
- **No model sees text a site marked `ai-input=no`.** Such documents are skipped before any call, not filtered afterwards.
- **Cache without expiry**, keyed by the text hash, provider, model and prompt version. Changing the prompt means a new
  version file; a test pins the hash of the current one.
- **Quotes are matched after normalisation** (NFKC, straight quotes, one kind of dash, single spaces, lower case) and stored as
  the exact span of the original document, with offsets. The quote shown is the site's text, never the model's copy.
- **A clause that overlaps text addressed to AI readers is dropped.** If a sentence telling AI systems what to report is
  quarantined, nothing quoted from it can become evidence, even if the reader labelled it as a clause.
- **Offline reader for tests.** With `IZIN_FAKE=1` a small keyword reader builds replies in the same JSON shape, so the whole
  pipeline runs without network. It is never used in production.

## Consequences

- A check can still end without a reading of some document; that document counts as unreadable and caps the verdict at ASK.
- Operator alerts (credit used up) go through a command set per host; without it they are only logged.
