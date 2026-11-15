<p align="center"><img src="https://raw.githubusercontent.com/aimanmalib/izin/main/brand/logo-512.png" width="112" height="112" alt="Izin"></p>

<h1 align="center">Izin</h1>

<p align="center"><a href="https://github.com/aimanmalib/izin/actions/workflows/ci.yml"><img src="https://github.com/aimanmalib/izin/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="https://github.com/aimanmalib/izin/releases/latest"><img src="https://img.shields.io/github/v/release/aimanmalib/izin" alt="Latest release"></a> <a href="https://github.com/aimanmalib/izin/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a> <a href="https://izin.sasateguh.com"><img src="https://img.shields.io/badge/demo-live-brightgreen" alt="Live demo"></a></p>

<p align="center"><b>Ask the site before your agent acts.</b> · <i>Tanya laman itu dahulu sebelum ejen anda bertindak.</i><br>
<a href="https://izin.sasateguh.com">live demo</a> · <a href="https://platform.openserv.ai/workspace/paywall/fb83abb51ca746e5b72e768c2e6076c9">OpenServ x402 Agent Market listing</a> · <a href="https://izin.sasateguh.com/docs">API and MCP</a> · <a href="https://youtu.be/U0_YkMaHXzA">video, 87 s</a> · <a href="docs/deck.pdf">slides</a> · <a href="docs/UKUR.md">what we measured</a> · <a href="#documentation">documentation</a> · <a href="CHANGELOG.md">changelog</a> · Built in Malaysia by <a href="https://aimanmalib.com">Aiman Malib</a></p>

Before an AI agent acts on a website, Izin answers GO, ASK or NO-GO for one action and quotes the clause from the site's
robots.txt and terms.

![Izin checks buying on ebay.com: the robots.txt comment a parser skips, one site and one action, then NO-GO with the clause quoted](docs/media/hero.gif)

The [narrated demo video](https://youtu.be/U0_YkMaHXzA) is 87 seconds and is also attached to the [latest release](https://github.com/aimanmalib/izin/releases/latest).

[Bahasa Melayu: README.ms.md](README.ms.md)

**See a real answer:** [buy or book on ebay.com, NO-GO](https://izin.sasateguh.com/r/yddnqgirk6). eBay's robots.txt
directives leave the home page open to crawlers, and a comment in the same file says "Checkouts are strictly for human
users." A parser skips that comment block. Izin quotes the rule written under it, against flows that place orders
without human review.

[![Izin receipt: buy or book on ebay.com, NO-GO, with the quoted clauses](docs/media/receipt-ebay-purchase.png)](https://izin.sasateguh.com/r/yddnqgirk6)

**Not every answer is no:** [buy or book on walmart.com, ASK](https://izin.sasateguh.com/r/u5ge2ipvmz). Walmart's terms
have a section for agents. Izin quotes it and lists the two things to confirm first: the agent is expressly authorized
by the customer, and it meets Walmart's registration and technical requirements.

**Why two models.** The open model on Dolphin reads every word cheaply, and anyone can repeat the reading. SERV Reasoning
makes the call: it answers in a strict schema that cites clause ids, its Prompt Guard refuses a request that tries to
talk it into GO (the [trap](https://izin.sasateguh.com/trap) shows this live), and on the benchmark it gave no false
NO-GO, where the open model deciding alone gave one.

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

4. An agent can also pay per call: on the [OpenServ x402 Agent Market](https://platform.openserv.ai/workspace/paywall/fb83abb51ca746e5b72e768c2e6076c9),
   or over x402 on a testnet. See [Who pays, and how](#who-pays-and-how).

The six actions are `read_page`, `crawl`, `train`, `account`, `purchase` and `post`. Endpoints, limits and error codes are
on [/docs](https://izin.sasateguh.com/docs).

## Why

Robots.txt directives can close paths to crawlers. They cannot say who may buy, whether a human must review an order, or
which route is approved. Sites write that in words: comments in robots.txt and their terms. A parser skips both.

The idea came from a hackathon radar that reads more than 20 sources. On 5 Nov 2026 a coding agent, working under my rules,
read the robots.txt and terms of 12 candidate sources before any was added. In 5 of them robots.txt allowed the page and
the terms banned scraping. In 2 the terms could not be read by a script. A robots check alone would have passed all 5.

## Who pays, and how

Izin is for teams that ship agents which buy, book, sign up or post on sites they do not own. Before the agent acts,
the team wants an answer it can keep: what the site's own words say about that action, quoted, with a receipt.

| Tier | Price | Status |
|---|---|---|
| Free | 6 new checks an hour | live |
| Agent, answer from a saved receipt | USD 0.01 a call | live on the Base Sepolia testnet, paid over x402 |
| Agent, fresh reading and decision | USD 0.05 a call | live on the OpenServ x402 Agent Market, paid in USDC on Base |
| Watch | USD 5 a month per 100 sites, re-read nightly | planned |

A decision is saved, and the same question within 24 hours is answered from the saved receipt. A fresh decision costs about 1 US cent on SERV (see below); an answer
from a saved receipt makes no model call, so each repeat lookup lowers the cost of an answer.

**On OpenServ.** Izin is an OpenServ agent (agent 4961) with one capability, `check`, sold per call on the Agent Market:
[Izin: check one agent action](https://platform.openserv.ai/workspace/paywall/fb83abb51ca746e5b72e768c2e6076c9). A buyer,
or another agent, sends a page URL and an action and gets the verdict, the quoted clauses and the receipt link. The agent
is a small separate process ([`openserv/agent.ts`](openserv/agent.ts)) that asks the same public API as any other client,
so the limits and the spending cap apply to it too. The listing is priced in real USDC. The first paid call was made on 15 Nov 2026 from a second
wallet of mine, as a test: USD 0.05 settled on Base and the eBay answer came back
([transaction](https://basescan.org/tx/0x20bc7ffa9241e44c67d51df4f945966946c7314f4807d1b74b27d3970d701847),
[ADR 0023](docs/decisions/0023-openserv-agent-on-the-x402-market.md)). The listing also has an on-chain identity,
registered in the ERC-8004 registry on Base: [agent 1189473 on 8004scan](https://8004scan.io/agents/base/1189473).

**On this site.** The paid route answers HTTP 402 with x402 payment terms. An x402 client signs the payment and retries:

```sh
curl -si 'https://izin.sasateguh.com/api/paid/check?url=https://www.ebay.com/&action=purchase'
# HTTP/2 402 with a PAYMENT-REQUIRED header: USD 0.01 in test USDC on Base Sepolia
```

This is a testnet, so the USDC has no value. The route sells saved answers only, charges nothing when no receipt is
saved, and is off unless the deployment sets a receiving address
([ADR 0022](docs/decisions/0022-paid-answer-over-x402-testnet.md)). Checked on 15 Nov 2026 through the public x402
facilitator: a request with no payment gets the terms, a signed payment from a test wallet with no funds is refused
for its balance, and the first funded payment settled. It paid USD 0.01 in test USDC for the eBay answer above:
[transaction on Base Sepolia](https://sepolia.basescan.org/tx/0x19a9401d0de99decc8aa8987ecf312f7e67eddea7cb958b5960464abfda272b3).

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
      |           a GO next to a prohibiting clause becomes ASK; for crawl, account, purchase
      |           and post, so does a GO with no clause quoted from the site's terms;
      |           text addressed to AI readers, or a Crawl-delay on a crawl, caps it at ASK
   receipt  what was fetched and when, the quoted clauses with links, the ceilings, a hash
```

A failure at any step (a block, a page that could not be read, no valid decision) ends in ASK, never GO.

## Where Dolphin runs

The reading step. [`server/baca/reader.ts`](server/baca/reader.ts) (`readDoc`, line 107) sends each policy document to
Dolphin's `deepseek-ai/DeepSeek-V4.1-Flash` ([`config/izin.json`](config/izin.json), `reader.primary`), streamed, at
temperature 0, with thinking off (`reasoning_effort: "none"`). With thinking on, the model spent its whole token budget on
reasoning for three of five real policy pages and returned no JSON ([ADR 0012](docs/decisions/0012-g1-reader-thinking-and-guard-mode.md)).

Why Dolphin: reading every word of a long terms page is cheap there, and open weights mean anyone can re-run the reading
step with the same model. We did, on 15 Nov 2026 (`npm run reread`, [`bench/runs/reread.json`](bench/runs/reread.json)):
33 stored policy documents were read again with the same model and prompt at temperature 0. 14 came back with exactly the
same quotes, and 283 of the 348 stored quotes were returned again. So a reading is repeatable in most of its quotes, not in
all of them, which is why a receipt keeps the reading it was decided on. The quote check in [`server/semak/quotes.ts`](server/semak/quotes.ts) (`verifyDocClauses`,
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

The gallery run of 10 Nov was decided with Multipath on: its receipts, including the eBay receipt above, name
`gpt-6-luna-serv-multipath`. Checks made since 14 Nov use `gpt-6-luna` without Multipath. The Multipath variants of the
benchmark could not be measured after the credit ran out, and the decider that ships is the configuration the published
numbers describe ([ADR 0017](docs/decisions/0017-shipped-decider-variant.md)). A fresh decision on SERV costs about 1 US cent
(USD 0.0122 a decision in the benchmark, estimated at the cost factor calibrated against the SERV console balance,
[ADR 0019](docs/decisions/0019-serv-cost-from-console-balance.md)). A saved receipt answers the same question for 24 hours and makes no new model call.
When SERV rejects a feature combination, the request steps down a ladder (no Shadow Agent, then the base model, then JSON
checked in code) and the receipt records the rung.

The ceilings are plain code in [`server/putus/siling.ts`](server/putus/siling.ts) (`applyCeilings`, line 79).

## What we measured

All numbers below come from [`docs/UKUR.md`](docs/UKUR.md), which the scripts in `scripts/` generate from stored receipts
and ledgers. That file also lists every counted receipt.

**Gallery run, 10 Nov 2026:** 24 sites, 144 site and action pairs, 144 receipts. GO 0, ASK 123, NO-GO 21. The SERV credit ran
out partway through, so 41 of 144 receipts carry a valid decision; the others stay at ASK.

**Gallery now, 15 Nov 2026:** runs on 14 and 15 Nov decided the pairs left without a decision and checked some pairs
again after ceiling S11, so the gallery shows 144 receipts from three runs. GO 2, ASK 93, NO-GO 49. The decision step
gave a valid answer on 123. On 18 the code decided without calling it (no clause to weigh, or nothing readable) and kept
ASK; on 3 the answer cited a clause that is not in the text, so ceiling S8 applied.

**Words against directives** (current gallery receipts): a robots.txt parser alone answers "allowed" for 126 of the 144
pairs. In **72 of those 126**, a
quoted clause from the site restricts or forbids the action and Izin answered ASK or NO-GO on that clause.

**Benchmark** on 43 pairs fixed before the run (13 recorded decisions, 20 designed cases, 10 spot checks), all variants
deciding on the same frozen evidence:

| Variant | Decider | Agree | False GO | False NO-GO | Cost per decision (USD, estimated) | Median time |
|---|---|---|---|---|---|---|
| V0 | Dolphin `DeepSeek-V4.1-Flash`, no SERV features | 36 of 43 | 1 | 1 | 0.000032 | 3.1 s |
| V1, ships | SERV `gpt-6-luna` | 31 of 43 | 3 | 0 | 0.0122 | 12.9 s |

False GO for the shipped decider in that run: 2 of 20 designed cases, 0 of 10 spot checks, 1 of 13 recorded decisions.
Two came from pages that tell AI readers what to answer (B09, the injection case, and B20): the code set the sentence aside
and only lowered the confidence, and the decision step still answered GO. The third (A09) was a crawl on a site whose
robots.txt sets a Crawl-delay.

**Re-measure with the current ceilings:** two code ceilings now cap those cases at ASK
([ADR 0020](docs/decisions/0020-two-signal-ceilings-and-remeasure.md)), and a third caps a GO for crawl, account, purchase
or post that quotes no clause from the site's terms ([ADR 0021](docs/decisions/0021-go-needs-a-quoted-policy-clause.md)).
That third ceiling also lowers one designed case whose expected answer is GO (B07) to ASK. Applied to the same stored
answers, with no site fetched and no model called:

| Variant | Agree | False GO | False NO-GO |
|---|---|---|---|
| V0 | 36 of 43 | 0 of 43 | 1 of 43 |
| V1, ships | 33 of 43 | 0 of 43 | 0 of 43 |

**Reading cost:** 462,675 tokens read on Dolphin over 57 stored readings, USD 0.006070. In the gallery and benchmark runs,
100% of reader tokens were served by Dolphin.

## Limits

- It does not render JavaScript. A terms page that needs a browser is reported as unread, and the answer is ASK.
- It obeys robots.txt and stops there; a site that blocks IzinBot is reported as blocked.
- GO means no restriction was found in what was read. For crawl, account, purchase and post it also needs a clause
  quoted from the site's terms; silence alone is ASK. Izin reads public text and reports what it says; it is a starting
  point for a decision, not advice.
- The benchmark is small (43 pairs). False GO for the shipped decider in the run: 2 of 20 designed cases, 0 of 10 spot
  checks, 1 of 13 recorded decisions; 0 of 43 after the re-measure with the current ceilings.
- The public instance has daily and total spending caps. When the SERV cap is reached, or SERV answers that the credit is
  gone, the open model on Dolphin decides instead, under the same rulebook and the same code ceilings, and the receipt says
  so ([ADR 0024](docs/decisions/0024-open-model-decides-when-serv-is-out.md)). When the Dolphin cap is reached it serves
  stored receipts only.
- The paid route on this site runs on a testnet and sells saved answers only. The listing on the OpenServ Agent Market
  is priced in real USDC; it answers through the same API, so a rate limit or the spending cap can refuse a check there too.

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

## Documentation

| Document | What it holds |
| --- | --- |
| [docs/UKUR.md](docs/UKUR.md) | Every measurement: benchmark runs, gallery, reading cost, the re-measure and the repeatability run |
| [docs/decisions/](docs/decisions/) | The decisions, one record each, with what was checked and how to undo it |
| [docs/deck.pdf](docs/deck.pdf) | The submission slides, built from [`deck/slides.yaml`](deck/slides.yaml) |
| [docs/BUILD-LOG.md](docs/BUILD-LOG.md) | One line for each day of work |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Set up, the gate, and what a change to a verdict needs |
| [API and MCP](https://izin.sasateguh.com/docs) | The check API, the MCP tool and the paid route, on the live site |
| [README.ms.md](README.ms.md) | A short version of this page in Malay |

## Built for

Built for SERV Hackathon 02 (Dolphin track), November 2026, by [@aimanmalib_](https://x.com/aimanmalib_). Initial commit:
`888ec0a`.

## AI disclosure

Built with Claude Code. The code, tests and text in this repository were written by an AI coding agent working under my
rules. The problem comes from my own work. I decide what ships. The narration in the demo video is an AI clone of my own voice; its music is by Sascha Ende, ende.app (CC BY 4.0).

## Disclaimer

Izin reads public text and reports what it says. Its answers are a starting point for a decision, not advice.

## License

MIT. See [LICENSE](LICENSE).
