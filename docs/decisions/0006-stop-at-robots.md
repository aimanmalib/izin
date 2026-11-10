# 0006. Stop at robots.txt when it forbids the action

Status: accepted

## Context

Some robots.txt files state the rule in plain words above the directives, for example that checkout
is for human users only or that automated access without written permission is prohibited. Robots
parsers skip those comments. If Izin then went on to fetch the home page and the terms, it would be
doing the thing the file asks automated clients not to do, in order to tell an agent not to do it.

## Decision

- After robots.txt is read, the collector checks it against the action being checked. When the
  file forbids that action for automated clients, nothing else is fetched from the site.
- A policy comment forbids the action when one of its sentences names a prohibition, addresses
  automated clients, and either covers everything ("without written permission") or names this
  action (checkout and orders for `purchase`, sign-up for `account`, and so on). The patterns live
  in `config/izin.json` under `robots_stop`; code only applies them.
- A Disallow rule covering the URL also stops collection for the actions in
  `robots_stop.directive_actions` (`crawl`), where ceiling S1 already sets NO_GO and the terms
  could not change the outcome.
- The comment is still read and quoted like any other policy text. The receipt records
  `fetched: robots.txt only` with the matching sentence, and the unread pages are listed as
  `stopped_at_robots_txt`, so ceiling S5 keeps the verdict at ASK unless a quoted prohibition makes
  it NO_GO. Silence in what was read never becomes GO after a stop.
- A check without an action (the readability run) never stops early.

## Consequences

One request instead of up to eight for the clearest cases, and receipts that show Izin followed the
rule it reports. A sentence the patterns miss leads to normal discovery, as before; a sentence they
match wrongly costs the terms reading but cannot produce GO. Undo: remove the `robotsStop` call in the collector.
