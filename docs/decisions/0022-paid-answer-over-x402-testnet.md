# 0022. A paid answer over x402, on a test network

Status: accepted. An exception to the feature freeze of [ADR 0018](0018-feature-freeze-v0.9.0.md):
one read-only route, added on 15 Nov 2026 before submission.

## Context

The site listed an agent tier as planned: USD 0.01 for an answer from a saved receipt and USD 0.05
for a fresh reading and decision. A price list with no way to pay says little about whether an
agent can buy the answer. Agents that pay per call already have a protocol for it, x402: the server
answers HTTP 402 with the terms, the client signs a payment and retries.

A testnet route had been planned for the build and was cut for time before the freeze. The saved
answers it sells already exist, so the route needs no new model call and no change to how a
verdict is made.

## Decision

- `GET /api/paid/check?url=&action=` sells the newest saved receipt for a site and action, in the
  short form the MCP tool returns, plus the time it was read. The price is the saved-answer tier in
  `config/izin.json` (`web.tiers.agent_usd_per_saved_answer`).
- Payment is x402 version 2, scheme `exact`, in test USDC on Base Sepolia, through the public
  facilitator at `x402.org`. The official packages do the protocol work (`@x402/fastify`,
  `@x402/core`, `@x402/evm`); Izin adds the route and its config. They are pinned to exact
  versions that had been public for at least 14 days when they were added, and so is `viem`.
- **Testnet only.** The config schema accepts `x402.testnet: true` and nothing else, so a move to
  real money needs a code change and a new decision. Every text about the route says testnet.
- **Off unless a receiving address is set.** The route is registered only when `x402.enabled` is
  true and the environment variable named in `x402.pay_to_env` holds a well-formed address. The
  address is a deployment value and is not in the repository.
- **Only saved answers.** The route reads the store. It never fetches a site, never calls a model
  and never spends credit, so test money cannot drain the paid model budget. A fresh check at the
  higher price stays planned.
- **Only receipts that rest on the site's own pages.** A check made with a caller's detail, agent
  token or pasted terms is never sold as the answer for the site, and neither is a benchmark run.
- **No charge for a miss.** Settlement runs after the handler and only for a 2xx answer. No saved
  receipt answers 404 and bad input answers 400; the payment is not settled in either case.
- The payment hooks are registered inside their own Fastify scope, so no other route passes
  through them. A facilitator that is down affects the paid route alone (502).

## Consequences

- An agent with an x402 client can pay for an Izin answer today, with test money. No agent has to:
  the free API and the MCP tool are unchanged.
- What the paid route adds over the free one today is the payment rail itself. Saved receipts are
  also readable for free by id, and that stays so for this demo.
- Tests use a stand-in facilitator and a key made for the test (`tests/api-paid.test.ts`): the 402
  terms, a signed payment answered and settled once, no settlement on a miss, and other routes
  untouched.
- First settled payment on the live route, 15 Nov 2026 04:59 UTC: a test wallet paid USD 0.01 in
  test USDC for the saved answer on `ebay.com` and `purchase`, and the facilitator settled it on
  Base Sepolia in transaction
  `0x19a9401d0de99decc8aa8987ecf312f7e67eddea7cb958b5960464abfda272b3` (block 58984629).
- Undo: unset the address in the deployment environment (the route disappears and the page says
  "planned" again), or set `x402.enabled` to false.
