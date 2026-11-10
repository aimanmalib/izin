# 0002. How the collector fetches and what it counts as read

Date: 2026-11-10. Status: accepted.

## Context

Izin reads other people's websites to tell an agent whether it may act there. It must behave at least as well as it asks agents
to behave, it must not become a way to reach internal addresses, and it must be honest about what it could not read. A few
cases are not settled by the specification and needed a rule.

## Decision

- **One fetcher identity.** Every request uses `IzinBot/0.1 (+https://izin.sasateguh.com/bot)`, plain GET requests, no retries. A block or
  a challenge page is a finding, not something to work around.
- **Address guard before every connection.** DNS is resolved by Izin, every answer must be a public unicast address, and the
  socket connects to the address that was checked. Each redirect hop is checked again. Ports other than 80 and 443 are refused.
- **robots.txt applies to Izin's own fetches, per host.** A page that robots.txt disallows for IzinBot is not fetched and is
  reported as unreadable. A policy URL on another host gets that host's robots.txt checked before the page. A robots.txt that cannot be read
  (server error, timeout, block) is treated as "fetch nothing else", as RFC 9309 asks; a missing one (404) means no rules.
  `Crawl-delay` is honoured up to a configured cap so a check still fits its time limit.
- **The site's own pointers lead.** Gallery hints, then policy URLs named in the site's robots.txt comments (even on
  another domain), then scored links from the input and home pages, up to the configured number of policy pages.
- **Long robots.txt comments are documents.** A comment block above a configured length that talks about agents, bots,
  automation or AI is passed to the reader as `robots_comments`. The standard Content Signals preamble is a template, so a
  block that contains it is marked as boilerplate and is not read as the site's stance.
- **`ai-input=no` stops collection.** When robots.txt signals `ai-input=no` for IzinBot or for all agents, Izin fetches no pages
  and gives none of the site's text to a model. Pasted text is still read, because the requester supplied it.
- **The request budget counts logical fetches.** Redirect hops inside one fetch do not use extra budget; they are limited
  separately. Pages found but not fetched because the budget ran out are reported as unreadable.
- **Network errors count as unreadable.** A policy page that failed for any reason other than "not found" can never support GO.
- **Registrable domain without a downloaded suffix list.** The last two labels, or three for a short configured list of
  multi-part suffixes such as `co.uk`. Good enough to keep discovery on the same site; it is not used for any security decision.

## Consequences

Some checks end in ASK because Izin chose not to read something. That is the intended trade: a verdict rests on text Izin
was allowed to read. All lengths, limits, patterns and lists live in `config/izin.json`.
