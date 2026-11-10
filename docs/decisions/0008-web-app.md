# 0008. The web app is served by the API process and reads its settings from the API

Status: accepted

## Context

The front page and the receipt page must work on a phone, in English and Bahasa Melayu, without
text or values written into the code, and must not depend on a second server or a third-party
script.

## Decision

- The Vite build (`web/dist`) is served by the same process as the API and MCP. Hashed assets are
  cached for a year; HTML carries `no-cache, no-transform` and a strict Content Security Policy
  (`'self'` only, no inline script or style). Unknown paths get the app with status 404.
- `/r/<id>.json` returns the stored receipt; `/r/<id>` renders it.
- `GET /api/site` gives the page what it needs from config: chip order, examples
  (`config/examples.json`, read on each request so a saved receipt id needs no rebuild), tier
  prices, poll interval and the measured cost per check (averaged from stored receipts that reached
  the decision step; nothing is shown before the first one).
- All UI text is in `lang/en.json` and `lang/ms.json`; the HTML title and description are filled
  from `lang/en.json` at build time. A test keeps `{slots}` equal in both languages.
- A verdict is always a colour, a shape and a word. Quotes use a monospace font. No
  `backdrop-filter` and no animated blur.
- The server does not stream progress, so the five live steps follow rough timings from config;
  only the receipt says when a check is done.

## Consequences

Browser tests run against the real app with the offline reader and decider and synthetic sites
on loopback (`e2e/server.ts`), on Chromium and WebKit (iPhone 13). Rolling back means serving the
API alone: remove `registerStatic` and `/api/site` from `server/app.ts`.
