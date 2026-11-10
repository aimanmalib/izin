# 0005. Gallery sites are chosen by what the reader can read

Status: accepted

## Context

Many well-known sites answer automated requests with a block or a challenge page. A gallery built
from a list of famous names would show mostly ASK, because there would be no terms text to quote.

## Decision

- `config/candidates.json` lists about 60 candidate sites in priority order (buying, booking,
  accounts and posting first). Hosts in `do_not_fetch_hosts` are never fetched.
- `npm run readability` runs the normal collector once per site as IzinBot: robots.txt, the home
  page and policy pages within the usual request budget. No model is called and no terms text is
  stored; `bench/readability.json` keeps the outcome, the robots.txt status, the count of documents
  read and the URLs of the policy pages.
- A site is readable when at least one text written by the site can reach the reader: a policy
  page read in full (`read`), or a policy comment block in robots.txt (`robots_comments`, which
  covers sites whose terms pages answer with a block but whose robots.txt states the rule).
- `config/gallery.json` takes the first 24 readable sites in candidate order, with the policy pages
  that were read as hints. Every other site is listed in `blocked_reader` with its reason and is
  shown as "blocked the reader".
- A site that blocks IzinBot is a finding. There is no retry with another user agent, a proxy, a
  headless browser or any way around a challenge.

## Consequences

The gallery reflects what an honest reader can see today, and the blocked list is part of the
result. `npm run readability -- --pilih` rebuilds the gallery from the recorded run without
fetching anything.
