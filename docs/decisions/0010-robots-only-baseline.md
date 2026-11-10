# 0010. Robots-only baseline and its headline count

Status: accepted

## Context

A fair question for Izin is what it adds over reading robots.txt. A robots.txt parser answers one
question for one URL: may this user agent fetch it. It does not read comments, and it says nothing
about buying, posting or opening accounts. The gallery should show, pair by pair, what the parser
alone would answer next to Izin's verdict, and count where the two differ for a stated reason.

## Decision

- For every gallery pair with a finished receipt, `robots_only` is computed from the robots signals
  stored on the receipt (no new fetch, no model):
  - `no_robots`: no robots.txt was read (missing, blocked, or the check did not fetch).
  - `disallowed`: robots.txt disallows the checked URL for IzinBot, for `*`, or for the agent token
    the caller gave.
  - `allowed`: otherwise.
- The headline count `robots_allowed_words_restrict` is the number of pairs where all of these hold:
  - `robots_only` is `allowed`;
  - the final verdict is ASK or NO-GO;
  - the decision step's own verdict (`decided_by.serv_verdict`) is ASK or NO-GO, so the
    restriction comes from the decider reading the site's words, not from a code ceiling;
  - at least one decisive quoted clause (from a robots.txt comment or the site's terms) has a
    restricting stance. The stances that count are listed in `config/izin.json` under
    `baseline.restricting_stances` (`prohibits`, `restricts`, `requires`).
- An ASK that comes only from a failure (a block, a page that could not be read, the decision step
  unavailable) is not counted, even when the receipt lists a decisive clause: there is no decider
  verdict, or the decider answered GO and a ceiling lowered it. Clause quotes on a receipt have already
  been checked against the fetched text by code, so the count only rests on verified quotes.
- `/api/gallery` adds `robots_only` and `words_restrict` to each finished cell and a `baseline`
  object with the counts; `/api/bench` carries the same counts once a pair has a receipt. The
  gallery shows the parser's answer under each verdict and marks the counted cells.
- `npm run ukur` writes the "Robots-only baseline" section of `docs/UKUR.md` from the database or a
  saved `/api/gallery` response, between marker comments, so the number in the file always comes
  from data.

## Consequences

The count is conservative: a GO lowered to ASK by a code ceiling, or an ASK whose decisive clause is
only `unclear`, is not counted. Changing which stances count is a config edit; the definition here
must change with it.
