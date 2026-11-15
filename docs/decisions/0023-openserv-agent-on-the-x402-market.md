# 0023. Izin as an OpenServ agent on the x402 Agent Market

Status: accepted. A second exception to the feature freeze of [ADR 0018](0018-feature-freeze-v0.9.0.md),
added on 15 Nov 2026 before submission. It follows [ADR 0022](0022-paid-answer-over-x402-testnet.md).

## Context

ADR 0022 gave the saved-answer tier a payment rail on a testnet. The second agent price, USD 0.05
for a fresh reading and decision, was still only a line on a page. OpenServ runs an Agent Market
where a workflow is sold per call over x402, and other agents can find and pay for it there. A
check is exactly that shape: two inputs, one answer, a receipt.

## Decision

- Izin is registered as an OpenServ agent with one capability, `check {url, action}`. It returns
  the verdict, the reason, up to three deciding clauses and the receipt link as JSON, unchanged.
- One workflow sells it on the Agent Market at the fresh-check price in `config/izin.json`
  (`web.tiers.agent_usd_per_fresh_check`), paid in USDC on Base to the operator's wallet. A saved
  answer comes back at once for the same price; there is one listing, not two.
- The agent is a separate process with its own dependencies ([`openserv/`](../../openserv/)). It
  holds no model keys and no database: it calls the public API of the instance named in config and
  waits for the receipt. The API's limits, saved answers and spending cap therefore apply to
  marketplace calls as they do to every other client, and the capability reports them as they are.
- The platform account belongs to the operator. Its user API key and the file the SDK writes
  (`.openserv.json`) live in a state folder outside the repository. A deployed copy refuses to
  start without that file, so a wrong mount cannot register a second agent.
- The agent keeps an outbound tunnel to the platform. It needs no route and no published port,
  and runs as its own container with a CPU and memory limit ([`deploy/openserv.sh`](../../deploy/openserv.sh)).
- Listing texts are in `lang/en.json` and `lang/ms.json` (`openserv`), the agent's system prompt in
  `prompts/`, and the values in `config/izin.json` (`openserv`).

## What was checked

- The listing appears in the public service list (`GET https://api.openserv.ai/x402-services`)
  with its price, input schema and paywall link, and its payment terms name USDC on Base and the
  operator's wallet as the payee.
- The workflow ran end to end on 15 Nov 2026 by firing its trigger as the owner: the platform
  handed the task to the agent through the tunnel and the task finished with Izin's JSON answer
  for `ebay.com` and `purchase`, unchanged.
- The first paid call was made on 15 Nov 2026 06:56 UTC through the paywall, from a second wallet of
  the operator as a test (the platform refuses a payment from the payee's own address). USD 0.05 in
  USDC settled on Base in transaction
  `0x20bc7ffa9241e44c67d51df4f945966946c7314f4807d1b74b27d3970d701847` and the task returned the
  answer for `ebay.com` and `purchase`. No outside buyer has paid yet.
- The capability logic is unit tested with a stand-in API (`tests/openserv-check.test.ts`).

## Consequences

- The fresh-check tier is now something a person or an agent can buy, in real money, in the
  organiser's own market. The price is above what a fresh decision costs to make
  ([ADR 0019](0019-serv-cost-from-console-balance.md)).
- One more process to keep running. If it stops, the listing stays visible and calls go
  unanswered; the site, the API and the MCP endpoint are not affected.
- The SDK's own sign-up by wallet no longer works against the platform API, so registration
  needs a user API key from the platform's profile page.
- Undo: `deploy/openserv.sh --stop`, delete the workflow on the platform, and set
  `openserv.paywall_url` to null; the pages then describe the fresh-check tier as planned again.
