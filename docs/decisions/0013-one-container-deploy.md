# 0013. One container behind the reverse proxy

Status: accepted

## Context

Izin serves an API, an MCP endpoint and a small web app. All three read the same SQLite file
(receipts, reader cache, spending ledger), so they must share one process, and the spending caps
only hold if one process counts every paid call.

## Decision

- One image, built from a clean `git archive` of HEAD (untracked and ignored files, keys included,
  never reach the build context). Stage one runs `npm ci` and the build; stage two carries
  `dist/`, `web/dist/`, production `node_modules` and the folders the server reads at run time
  (`config/`, `lang/`, `prompts/`, `bench/`, `fixtures/`). It runs as the `node` user with a
  read-only root file system; only the named volume `izin-data` (the database) is writable.
- No published port. The host's reverse proxy routes the public name to the container, adds
  compression (HTML is sent with `no-transform`, so a CDN in front leaves it alone) and redirects
  http to https. The server's own timeout (95 s) stays under the CDN's 100 s limit.
- Host values (proxy container, network, key file, notifier, builder) live in `deploy/hos.env`,
  which is not tracked. The keys reach the container as environment variables from a 0600 file.
- `deploy/deploy.sh --rollback` runs the previous image again; a stopped holder container keeps
  that image so disk clean-up cannot remove it.
- The container cannot run the host's notifier, so the server logs operator alerts as JSON lines.
  `deploy/uptime.sh` (cron, every 5 minutes) relays them, each text once per UTC day, and sends one
  "unhealthy" alert after two failed checks in a row.
- The first deploy may seed the empty volume with the database of earlier paid measurement runs
  (`--seed-db`), so the spending caps count money already spent.

## Consequences

A restart loses nothing but in-flight checks, which the next boot marks as errors. Scaling past
one container would need a shared ledger first; it is not needed at this size.
