# 0007. One check service behind the API and MCP, with its limits

Status: accepted

## Context

Checks arrive from the web page, the HTTP API and MCP. Each new check fetches a third-party site
and costs model credit, so the same limits must hold whichever door a request uses, and a check
must survive a restart as a record even if its work does not.

## Decision

- One service validates, answers from the cache, applies limits and queues. The HTTP routes and
  the MCP tools are thin adapters over it.
- Input is refused with 400 before anything is queued: unknown action, a URL that is not public
  http(s), credentials in the URL, an over-long detail, or an address the fetch rules would refuse
  (private, loopback, link-local, cloud metadata, CGNAT, ports other than 80 and 443).
- Email addresses and phone numbers are replaced with `[email]` and `[phone]` in the detail before
  it is stored or sent to a model. The patterns are in `config/izin.json` under `privacy`.
- Cache key: normalised origin and action, with no detail, no agent token and no pasted terms,
  within `cache_hours`. Queued and running checks count, so two identical requests share one check.
- A site whose robots.txt forbade any automated access is not fetched again for
  `no_refetch_blocked_days`: requests for that site get the stop receipt back (`no_refetch: true`).
  That receipt never carries GO, so reusing it for another action cannot open anything up.
- Rate limits count new checks only: `rate_new_checks_per_ip_hour` per client address on a sliding
  hour, and `rate_new_checks_per_day` in total per UTC day (kept in the database). The client
  address is taken from forwarding headers only along a known chain: the socket peer is the reverse
  proxy, and `cf-connecting-ip` counts only when the proxy's last hop is a Cloudflare edge. The ranges
  are in config with their public source URL.
- Spending: each check's reader cost per provider and the decider estimate go into a per-day table.
  A model with no listed price is counted at the provider's highest listed price, never at zero.
  When a daily or total cap is reached, new checks answer 503 `budget_exhausted` (with a recent
  receipt id for the same site and action when one exists), saved receipts are still served,
  `/api/health` reports `cache_only: true`, and the operator gets one alert per day. Build scripts
  are exempt from the daily caps, not from the totals.
- Queue: in process, `queue_concurrency` checks at once, each limited to `check_timeout_s`. A check
  past the timeout is reported as an error but keeps its slot until it really ends; if it then
  finishes, its receipt is kept. Rows left queued or running when the process stopped are marked as
  errors at boot.
- MCP is stateless Streamable HTTP: every POST to `/mcp` gets a fresh server and transport, so no
  session lives in memory and any replica can answer. `izin_check` waits up to `mcp_wait_s` and then
  returns `{status: "running", id, retry_after_s}` for `izin_receipt`.

## Consequences

- The per-address window lives in memory and resets on restart; the daily totals do not.
- Undo: each limit is a config value; the cache and the no-re-fetch rule can be set to one hour or
  one day without code changes.
