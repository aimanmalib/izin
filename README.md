# Izin

Before an AI agent acts on a website, Izin answers GO, ASK or NO-GO for that one action, and quotes the exact clause from the
site's own robots.txt and terms that the answer rests on.

Status: early build. The service, API and MCP server are not live yet. This file grows with the code.

## What it does

You give Izin a site and an action. The six actions are: read a page, crawl, train a model, open an account, buy or book, and
post content. Izin fetches the site's robots.txt and policy pages as `IzinBot`, then answers in three steps:

1. **Read.** An open-weights model on Dolphin extracts the clauses that matter, each with its exact wording.
2. **Decide.** SERV Reasoning weighs those clauses against the action and returns a structured verdict.
3. **Ceilings.** Plain code checks every quote against the fetched text and holds the final word. A quote that is not in the
   source is dropped. A verdict without verified evidence never becomes GO.

Every check produces a receipt: what was fetched, when, the quoted clauses, and a hash of the result.

## IzinBot

Izin fetches pages with an honest user agent, `IzinBot/0.1 (+https://izin.sasateguh.com/bot)`. It obeys robots.txt, does not
render JavaScript, uses no proxies, and does not try to get past blocks or challenges. A site that blocks it is reported as
blocked. That is a finding, not an error.

## Built for

Built for SERV Hackathon 02 (Dolphin track), November 2026.

## AI disclosure

Built with Claude Code. The problem comes from my own work. The code, tests and text in this repository were written by an AI
coding agent working under my rules. I chose the problem and I decide what ships.

## Disclaimer

Izin reads public text and reports what it says. Its answers are a starting point for a decision, not advice.

## License

MIT. See [LICENSE](LICENSE).
