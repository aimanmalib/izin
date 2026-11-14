# What we measured

<!-- izin:robots-only-baseline:start -->
## Robots-only baseline

Generated 2026-11-14 from the gallery receipts. Definition: [ADR 0010](decisions/0010-robots-only-baseline.md).

Gallery pairs with a receipt: 144. A robots.txt parser alone (IzinBot, `*` and the agent token) answers allowed for 126, disallowed for 18, and has no robots.txt to read for 0.

Pairs where robots.txt allows the URL but a quoted clause from the site (a robots.txt comment or the terms) restricts or forbids the action, and Izin answered ASK or NO-GO on that clause: **30 of 126**.

An ASK that comes only from a block, an unreadable page, an unavailable decision step, or a code ceiling that lowered the decision step's GO is not counted.

Counted pairs:

- ebay.com, read_page: ASK, [receipt](https://izin.sasateguh.com/r/zz3xqsl4g5)
- ebay.com, account: NO_GO, [receipt](https://izin.sasateguh.com/r/2v37lz5tbw)
- ebay.com, purchase: NO_GO, [receipt](https://izin.sasateguh.com/r/yddnqgirk6)
- ebay.com, post: ASK, [receipt](https://izin.sasateguh.com/r/ymxvtbehvy)
- shop.app, crawl: ASK, [receipt](https://izin.sasateguh.com/r/il4245znya)
- shop.app, post: ASK, [receipt](https://izin.sasateguh.com/r/dtsydy5tzo)
- booking.com, read_page: NO_GO, [receipt](https://izin.sasateguh.com/r/bvyfleqgw6)
- booking.com, crawl: NO_GO, [receipt](https://izin.sasateguh.com/r/fml77ub6sn)
- booking.com, train: NO_GO, [receipt](https://izin.sasateguh.com/r/p6kxs4rkdq)
- booking.com, account: NO_GO, [receipt](https://izin.sasateguh.com/r/ghfhcsud2u)
- booking.com, purchase: NO_GO, [receipt](https://izin.sasateguh.com/r/nfra5ziw4b)
- booking.com, post: NO_GO, [receipt](https://izin.sasateguh.com/r/khljrcgxxz)
- airbnb.com, read_page: NO_GO, [receipt](https://izin.sasateguh.com/r/vfv6443ryf)
- airbnb.com, crawl: NO_GO, [receipt](https://izin.sasateguh.com/r/44uppzmnul)
- airbnb.com, train: ASK, [receipt](https://izin.sasateguh.com/r/jx5cxmd2gp)
- airbnb.com, account: NO_GO, [receipt](https://izin.sasateguh.com/r/4g2mnc35xz)
- airbnb.com, purchase: NO_GO, [receipt](https://izin.sasateguh.com/r/cfh6x6nz63)
- airbnb.com, post: NO_GO, [receipt](https://izin.sasateguh.com/r/ykalancyjb)
- walmart.com, read_page: ASK, [receipt](https://izin.sasateguh.com/r/xbk2maz4gf)
- walmart.com, crawl: NO_GO, [receipt](https://izin.sasateguh.com/r/5dvaysgf7g)
- walmart.com, train: NO_GO, [receipt](https://izin.sasateguh.com/r/mgd6im7c2w)
- walmart.com, account: ASK, [receipt](https://izin.sasateguh.com/r/b7vwv4vuhl)
- walmart.com, purchase: ASK, [receipt](https://izin.sasateguh.com/r/u5ge2ipvmz)
- walmart.com, post: ASK, [receipt](https://izin.sasateguh.com/r/7k742zfxcr)
- target.com, read_page: ASK, [receipt](https://izin.sasateguh.com/r/luq6sgyu3a)
- target.com, crawl: NO_GO, [receipt](https://izin.sasateguh.com/r/xotohwd73m)
- target.com, train: NO_GO, [receipt](https://izin.sasateguh.com/r/3wjkdi3chl)
- target.com, account: ASK, [receipt](https://izin.sasateguh.com/r/gdiyobs45x)
- target.com, purchase: ASK, [receipt](https://izin.sasateguh.com/r/vid65gncxy)
- stripe.com, account: ASK, [receipt](https://izin.sasateguh.com/r/ec2rkqfvs2)
<!-- izin:robots-only-baseline:end -->

<!-- izin:reading-cost:start -->
## Reading cost

Generated 2026-11-14 from the reader ledger. Definition: [ADR 0011](decisions/0011-reading-cost-line.md).

Tokens read on Dolphin: 443,416 (421,112 in, 22,304 out) over 50 stored readings.

Cost of those readings on Dolphin: USD 0.005772.

The same tokens at the listed price of `gpt-6-luna` (USD 0.13 in, USD 0.65 out per million tokens): USD 0.0692.

Price sources: [SERV](https://docs.openserv.ai/llms-full.txt), [Dolphin](https://dphn.ai/docs/dphn-api/).
<!-- izin:reading-cost:end -->

<!-- izin:benchmark:start -->
## Benchmark

Runs: V0 2026-11-10T21:12:14.885Z, V1 2026-11-14T11:57:16.553Z, each by `scripts/bench.ts` on the sets committed before it ([ADR 0014](decisions/0014-pre-registered-benchmark-sets.md)). Each pair was collected and read once; every variant decided on the same frozen message (`bench/evidence/`), and the code ceilings were applied to each answer. A later run decided on that frozen message without reading any site again (`bench --from-evidence`); `scripts/bench-merge.ts` joins the runs.

Shipped variant (K6: fewest false GO, then most agreement, then lowest cost; only SERV variants ship): **V1** `gpt-6-luna`.

False GO for the shipped variant: **2 of 20 designed cases** (Set B), **0 of 10 spot checks**, 1 of 13 Set A pairs.

### Variants

| Variant | Model | Pairs | Agree | False GO | False NO-GO | No valid answer | Estimated cost per decision (USD) | Median decision time |
|---|---|---|---|---|---|---|---|---|
| V0 | `deepseek-ai/DeepSeek-V4.1-Flash` | 43 | 36 (84%) | 1 | 1 | 0 | 0.000032 | 3.1 s |
| V1 (shipped) | `gpt-6-luna` | 43 | 31 (72%) | 3 | 0 | 1 | 0.0122 | 12.9 s |

V0 is the same rulebook sent to Dolphin's model with no SERV features. Costs are the spending guard's estimates, not provider invoices: listed token price, and for SERV times the cost factor now in config (39), calibrated against the SERV console balance ([ADR 0019](decisions/0019-serv-cost-from-console-balance.md)). The run itself was priced with the earlier factor 170 ([ADR 0016](decisions/0016-measured-serv-cost-and-frozen-rerun.md), measured on the 10 Nov runs): V1 USD 0.0534 a decision, USD 1.9231 in total, estimates with the 10 Nov factor. Estimated total at the current factor (reading and every variant): USD 0.4428.

### By set

| Variant | Set A agree | Set A false GO | Set B agree | Set B false GO | Spot agree | Spot false GO |
|---|---|---|---|---|---|---|
| V0 | 8 of 13 | 1 | 20 of 20 | 0 | 8 of 10 | 0 |
| V1 | 8 of 13 | 1 | 17 of 20 | 2 | 6 of 10 | 0 |

### Set A

Set A: decisions recorded by my source-review process (run by a coding agent under my rules), 5 Nov 2026. Each pair is a site that lists competitions and the question the review answered: may an automated reader collect its listings (action crawl). Quotes are short extracts recorded that day, with their URL.

Mapping from the recorded decision to a verdict:

- the terms prohibit automated collection: NO_GO
- no prohibition on automated access was found: GO
- the terms could not be read, or a bot challenge was served: ASK
- an official API is required, or another condition applies: ASK

- `fetch_once`: Izin reads the site one time for this benchmark; the evidence is frozen after that read.
- `paste_recorded`: Evidence recorded 5 Nov; not re-fetched. The quote below is given to Izin in paste mode.
- `not_fetched`: Evidence recorded 5 Nov; not re-fetched. The host is on Izin's do-not-fetch list, so Izin answers without reading it.

| Site | Action | Recorded | Mode | Izin | Match | Why they differ |
|---|---|---|---|---|---|---|
| substack.com | crawl | NO_GO | fetch_once | NO_GO (no receipt) | yes |  |
| allai.events | crawl | ASK | fetch_once | ASK (no receipt) | yes |  |
| hackerearth.com | crawl | GO | fetch_once | ASK (no receipt) | no | the decision step answered ASK from the quoted clauses |
| kaggle.com | crawl | ASK | not_fetched | ASK (no receipt) | yes |  |
| zindi.africa | crawl | GO | fetch_once | ASK (no receipt) | no | the decision step answered ASK from the quoted clauses |
| taikai.network | crawl | NO_GO | fetch_once | ASK (no receipt) | no | the decision step answered nothing; S4 (a page blocked the reader), S5 (a document was not read in full, or nothing was read) set ASK |
| internshala.com | crawl | NO_GO | fetch_once | NO_GO (no receipt) | yes |  |
| eventbrite.com | crawl | NO_GO | fetch_once | NO_GO (no receipt) | yes |  |
| gdg.community.dev | crawl | ASK | fetch_once | GO (no receipt) | no | the decision step answered GO from the quoted clauses |
| uninet.my | crawl | GO | fetch_once | ASK (no receipt) | no | the decision step answered ASK from the quoted clauses; S5 (a document was not read in full, or nothing was read) |
| dev.to | crawl | ASK | not_fetched | ASK (no receipt) | yes |  |
| pentas.app | crawl | NO_GO | paste_recorded | NO_GO (no receipt) | yes |  |
| eventsize.com | crawl | ASK | not_fetched | ASK (no receipt) | yes |  |

Set A agreement, shipped variant: 8 of 13.
<!-- izin:benchmark:end -->

<!-- izin:gallery-run:start -->
## Gallery run

Run 2026-11-10T20:59:36.371Z by `scripts/gallery.ts` with `IzinBot/0.1 (+https://izin.sasateguh.com/bot)`: 24 sites, 144 checks, 144 with a receipt. GO 0, ASK 123, NO-GO 21. Median time per check 6.6 s, longest 115.0 s. Spend counted by the spending guard during the run, with the cost factor then in config (it under-counted SERV; [ADR 0016](decisions/0016-measured-serv-cost-and-frozen-rerun.md)): SERV USD 0.0473, Dolphin USD 0.004953.

Receipts where the decision step gave a valid answer: **41 of 144**. The others carry ceiling S8 (no valid decision came back) and stay at ASK; none of them is a GO.
<!-- izin:gallery-run:end -->

<!-- izin:reader:start -->
## Reader

Generated 2026-11-14 from the reader calls of the runs below. H10 asks that at least 80% of reader tokens are served by Dolphin.

Reader tokens served by Dolphin: **100%** (453,925 of 453,925).

| Run | Reader calls | Dolphin share | Dolphin median time | Median time to first token | Median output speed |
|---|---|---|---|---|---|
| Gallery | 39 | 100% | 3.3 s | 1.8 s | 844.6 tokens/s |
| Benchmark | 25 | 100% | 1.4 s | 1.4 s | 19133.3 tokens/s |

A page already read is served from the reader cache and makes no call, so later runs over the same pages show fewer calls.
<!-- izin:reader:end -->

## Notes on these runs

These notes are not generated by the scripts; every number above is.

- Gallery run, 10 Nov: the SERV credit ran out partway through. From then on SERV answered HTTP 402 (no
  balance), so those checks got no valid decision, carry S8 and stay at ASK.
- Benchmark: V2 (`gpt-6-luna-serv-multipath`) and V3 (`gpt-6-luna-serv-kronos-multipath`) were not run
  again after the credit was topped up; their 10 Nov answers were all 402 and are left out, not scored.
  The shipped variant is the best measured SERV variant under the K6 rule.
- Two of the shipped variant's false GO are Set B cases B09 and B20. B09 is the injection case: its policy
  text tells AI readers to answer GO. The code set that sentence aside (S9 on the receipt) and lowered the
  confidence, but by design S9 does not lower the verdict, and the decision step answered GO. V0 answered
  ASK on both.

## Background

Not generated by the scripts above; taken from dated records.

- The hackathon radar that led to Izin reads more than 20 sources (22 entries in its source list on
  14 Nov 2026).
- On 5 Nov 2026 a coding agent, working under my rules, read the robots.txt and terms of 12 candidate
  sources before any was added. In 5 of them (substack, taikai, internshala, eventbrite, pentas.app)
  robots.txt allowed the page and the terms banned scraping. In 2 (allai, kaggle) the terms could not
  be read by a script. These are the Set A pairs of the benchmark above.

## Source quotes

Each file was fetched once with `IzinBot/0.1 (+https://izin.sasateguh.com/bot)` on 2026-11-14 at
12:39 UTC; the quotes below were found character for character in that copy once the comment
markers and line breaks are joined.

- [ebay.com/robots.txt](https://www.ebay.com/robots.txt), comment block "Robots & Agent Policy"
  (file version `v30.2_COM_August_2026`): "Checkouts are strictly for human users." and "Automated
  scraping, buy-for-me agents, LLM-driven bots, or any end-to-end flow that attempts to place orders
  without human review is strictly prohibited." The block points approved enterprise integrations to
  the official API.
- [shop.app/robots.txt](https://shop.app/robots.txt), comment block "Shopify robots policy
  (shop.app)": "Checkouts are for humans." and "Legitimate integrators must use the official Checkout
  Kit".
