# Izin

Before an AI agent acts on a website, Izin answers GO, ASK or NO-GO for one action and quotes the clause from the site's
robots.txt and terms.

**See a real answer:** [buy or book on ebay.com, NO-GO](https://izin.sasateguh.com/r/yddnqgirk6). eBay's robots.txt
directives leave the home page open to crawlers, and a comment in the same file says "Checkouts are strictly for human
users." A parser skips that comment. Izin quotes it.

[![Izin receipt: buy or book on ebay.com, NO-GO, with the quoted clauses](docs/media/receipt-ebay-purchase.png)](https://izin.sasateguh.com/r/yddnqgirk6)

## Try it in a minute

1. Open [izin.sasateguh.com](https://izin.sasateguh.com), pick an example or enter a site and an action.
2. Give it to your agent over MCP:

   ```sh
   claude mcp add --transport http izin https://izin.sasateguh.com/mcp
   ```

3. Or call the API. A check is queued and returns an id; the receipt is at `/api/receipt/{id}` and `/r/{id}`.

   ```sh
   curl -s https://izin.sasateguh.com/api/check -H 'content-type: application/json' \
     -d '{"url":"https://www.ebay.com/","action":"purchase"}'
   ```

The six actions are `read_page`, `crawl`, `train`, `account`, `purchase` and `post`. Endpoints, limits and error codes are
on [/docs](https://izin.sasateguh.com/docs).

## Why

Robots.txt directives can close paths to crawlers. They cannot say who may buy, whether a human must review an order, or
which route is approved. Sites write that in words: comments in robots.txt and their terms. A parser skips both.

The idea came from a hackathon radar that reads more than 20 sources. On 5 Nov 2026 a coding agent, working under my rules,
read the robots.txt and terms of 12 candidate sources before any was added. In 5 of them robots.txt allowed the page and
the terms banned scraping. In 2 the terms could not be read by a script. A robots check alone would have passed all 5.

## How a verdict is made

```text
 site + action
      |
   IzinBot fetches robots.txt, the home page and the policy pages it links to
      |
 1 Read     Dolphin: an open-weights model returns the clauses that matter, word for word
      |     code: every quote must be found in the fetched text, or it is dropped;
      |           sentences addressed to AI readers are set aside
 2 Decide   SERV Reasoning: a verdict in a strict JSON schema, citing clause ids
      |
 3 Ceilings code: robots.txt, Content Signals, blocks and unread pages cap the verdict;
      |           a GO that cites nothing, or sits next to a prohibiting clause, becomes ASK
   receipt  what was fetched and when, the quoted clauses with links, the ceilings, a hash
```

A failure at any step (a block, a page that could not be read, no valid decision) ends in ASK, never GO.

## Where Dolphin runs

The reading step. [`server/baca/reader.ts`](server/baca/reader.ts) (`readDoc`, line 107) sends each policy document to
Dolphin's `deepseek-ai/DeepSeek-V4.1-Flash` ([`config/izin.json`](config/izin.json), `reader.primary`), streamed, at
temperature 0, with thinking off (`reasoning_effort: "none"`). With thinking on, the model spent its whole token budget on
reasoning for three of five real policy pages and returned no JSON ([ADR 0012](docs/decisions/0012-g1-reader-thinking-and-guard-mode.md)).

Why Dolphin: reading every word of a long terms page is cheap there, and open weights mean anyone can re-run the reading
step with the same model. The quote check in [`server/semak/quotes.ts`](server/semak/quotes.ts) (`verifyDocClauses`,
line 69) keeps the reader honest. SERV is the fallback reader if Dolphin fails; the receipt names the model that read.

## Where SERV Reasoning runs

The decision step. [`server/putus/serv.ts`](server/putus/serv.ts) (`requestFor`, line 107; `decide`, line 151) calls
`gpt-6-luna` on SERV with:

- **a strict JSON schema** (`response_format: json_schema`), so the code can check every cited clause id;
- **Shadow Agent** (`serv_shadow_agent`), with a hint that rejects a NO-GO without a prohibiting clause, an ASK without a
  condition, and a GO that cites a prohibiting clause;
- **Prompt Guard** (`serv_prompt_guard`) declared when the code filter flags injected text in a clause or in the caller's
  detail. Declared on every request, it refused 8 of 10 normal policy payloads in the G1 run ([`docs/UKUR-G1.md`](docs/UKUR-G1.md)), so it is not on by default
  ([ADR 0012](docs/decisions/0012-g1-reader-thinking-and-guard-mode.md)).

Multipath is not used. The Multipath variants of the benchmark could not be measured after the credit ran out, and the
decider that ships is the configuration the published numbers describe ([ADR 0017](docs/decisions/0017-shipped-decider-variant.md)).
When SERV rejects a feature combination, the request steps down a ladder (no Shadow Agent, then the base model, then JSON
checked in code) and the receipt records the rung.

The ceilings are plain code in [`server/putus/siling.ts`](server/putus/siling.ts) (`applyCeilings`, line 57).

## What we measured

All numbers below come from [`docs/UKUR.md`](docs/UKUR.md), which the scripts in `scripts/` generate from stored receipts
and ledgers. That file also lists every counted receipt.

**Gallery run, 10 Nov 2026:** 24 sites, 144 site and action pairs, 144 receipts. GO 0, ASK 123, NO-GO 21. The SERV credit ran
out partway through, so 41 of 144 receipts carry a valid decision; the others stay at ASK.

**Words against directives:** a robots.txt parser alone answers "allowed" for 126 of the 144 pairs. In **30 of those 126**, a
quoted clause from the site restricts or forbids the action and Izin answered ASK or NO-GO on that clause.

**Benchmark** on 43 pairs fixed before the run (13 recorded decisions, 20 designed cases, 10 spot checks), all variants
deciding on the same frozen evidence:

| Variant | Decider | Agree | False GO | False NO-GO | Cost per decision (USD, estimated) | Median time |
|---|---|---|---|---|---|---|
| V0 | Dolphin `DeepSeek-V4.1-Flash`, no SERV features | 36 of 43 | 1 | 1 | 0.000032 | 3.1 s |
| V1, ships | SERV `gpt-6-luna` | 31 of 43 | 3 | 0 | 0.0534 | 12.9 s |

V1 has more false GO than V0 on this small set. One of them is the injection case: a policy page that tells AI readers to
answer GO. The code set that sentence aside and lowered the confidence, and the decision step still answered GO.

**Reading cost:** 443,416 tokens read on Dolphin over 50 stored readings, USD 0.005772. In the gallery and benchmark runs,
100% of reader tokens were served by Dolphin.

## Limits

- It does not render JavaScript. A terms page that needs a browser is reported as unread, and the answer is ASK.
- It obeys robots.txt and stops there; a site that blocks IzinBot is reported as blocked.
- GO means no restriction was found in what was read. Izin reads public text and reports what it says; it is a starting
  point for a decision, not advice.
- The benchmark is small (43 pairs) and the shipped decider gave 3 false GO on it.
- The public instance has daily and total spending caps. When a cap is reached it serves stored receipts and makes no new model calls.

## Related work

- [Maango](https://github.com/maango-io/maango-mcp) (MIT) answers content-use questions (train, scrape, summarize, index)
  per domain from AI-policy standards, over MCP.
- [Permission manifests for web agents](https://arxiv.org/abs/2601.02371) (`agent-permissions.json`) propose a robots.txt
  style file for agent actions.
- [IETF AI Preferences](https://datatracker.ietf.org/wg/aipref/about/), [RSL](https://rslstandard.org/),
  [TDMRep](https://www.w3.org/community/tdmrep/) and [Content Signals](https://contentsignals.org/) are machine-readable
  signals for AI use of content. Izin reads Content Signals when a site publishes them.
- [ToS;DR](https://tosdr.org/) summarises terms for people.

Where Izin differs:

1. It covers agent actions (buy, open an account, post) that sites state in words, not in directives.
2. Every quote is checked by code against the fetched text and kept in a receipt.
3. It reads the site itself at the time of the check, not a registry record.

## Run it

Node 22 and npm.

```sh
npm ci
npm run build
IZIN_FAKE=1 npm start          # http://localhost:8080, recorded fixtures, no keys, no network calls to models
```

With keys, copy `.env.example` to `.env`, set `SERV_API_KEY` and `DOLPHIN_API_KEY`, and run `npm start`. Tests:
`npm test` (unit, no network) and `npm run e2e` (browser). Values such as actions, limits, prices and caps live in
[`config/izin.json`](config/izin.json); UI text lives in [`lang/en.json`](lang/en.json) and [`lang/ms.json`](lang/ms.json).
Decisions are recorded in [`docs/decisions/`](docs/decisions/).

## IzinBot

Izin fetches pages with an honest user agent, `IzinBot/0.1 (+https://izin.sasateguh.com/bot)`. It obeys robots.txt, does not
render JavaScript, uses no proxies, and does not try to get past blocks or challenges. A site that blocks it is reported as
blocked. That is a finding, not an error.

**For site owners:** [/bot](https://izin.sasateguh.com/bot) explains what IzinBot fetches and how to block it. Izin quotes
your words back to the agent that asked, with a link to the sentence.

## Built for

Built for SERV Hackathon 02 (Dolphin track), November 2026, by [@aimanmalib_](https://x.com/aimanmalib_). Initial commit:
`888ec0a`.

## AI disclosure

Built with Claude Code. The code, tests and text in this repository were written by an AI coding agent working under my
rules. The problem comes from my own work. I decide what ships.

## Disclaimer

Izin reads public text and reports what it says. Its answers are a starting point for a decision, not advice.

## License

MIT. See [LICENSE](LICENSE).
