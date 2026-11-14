# 0011. Reading cost line

Status: accepted

## Context

Izin reads every word of a site's rules with an open model on Dolphin before the decision step runs.
Reading is the bulk of the tokens. A reader of the project should be able to see how many tokens were
read, what they cost, and what the same reading would have cost at the listed price of the SERV model
that serves as the fallback reader.

## Decision

- The numbers come from the `extractions` table, the ledger of stored readings. Only rows whose
  provider is Dolphin are counted. Each row gives tokens in, tokens out and the cost recorded for that
  reading; a row with no recorded cost is priced at its model's Dolphin price from config, or at the
  highest listed Dolphin price when the model is not listed, so the cost is never under-counted.
- The comparison prices the same tokens in and out at the listed price of
  `reading_cost.compare_model` in `config/izin.json` (`prices_usd_per_mtok.serv`). Config validation
  refuses a compare model without a listed price.
- The public price lists the prices were taken from are stored in config
  (`reading_cost.price_sources`) and shown next to the numbers.
- The line appears on `/bench`, under "What it costs" on the home page, in `/api/bench` and
  `/api/site` (`reading_cost`, null before any Dolphin reading), and in the "Reading cost" section of
  `docs/UKUR.md`, which `npm run ukur` regenerates from a database file or a saved `/api/bench`
  response.

## Consequences

- No number is typed in: a price change is a config edit, and the totals follow the ledger.
- A stored reading is replaced when the same document is read again with the same model and prompt,
  so the line counts the readings kept, not every call ever made. The daily spend table remains the
  record for the spending caps.
