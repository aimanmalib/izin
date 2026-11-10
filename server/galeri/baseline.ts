// Robots-only baseline (ADR 0010). For each checked (site, action) pair: what a robots.txt parser
// alone would answer, and whether Izin's verdict rests on the site's own quoted words that restrict
// the action although the parser allows it. Pure code over stored receipts; no model is called.
import type { Stance } from "../config.js";
import type { Receipt } from "../resit/receipt.js";

export type RobotsOnly = "allowed" | "disallowed" | "no_robots";

export type BaselineReceipt = Pick<Receipt, "verdict" | "clauses"> & {
  decided_by: Pick<Receipt["decided_by"], "serv_verdict" | "ceilings">;
  signals: Pick<Receipt["signals"], "robots">;
};

/**
 * The parser's answer for the checked URL, for the IzinBot, "*" and optional agent groups together:
 * "no_robots" when no robots.txt was read (missing, blocked or not fetched).
 */
export function robotsOnly(r: BaselineReceipt): RobotsOnly {
  const robots = r.signals.robots;
  if (!robots.fetched) return "no_robots";
  return robots.disallow_for_agent ? "disallowed" : "allowed";
}

/**
 * True when the parser allows the URL, the final verdict is ASK or NO-GO, the decider itself
 * answered ASK or NO-GO, and a decisive quoted clause (from a robots.txt comment or the terms) has
 * a restricting stance. A GO lowered to ASK by a code ceiling (S5 unreadable, S6 evidence, S8 ...)
 * does not count, nor does an ASK with no decider verdict at all (blocked, decider unavailable).
 */
export function wordsRestrict(r: BaselineReceipt, restricting: readonly Stance[]): boolean {
  if (robotsOnly(r) !== "allowed" || r.verdict === "GO") return false;
  const serv = r.decided_by.serv_verdict;
  if (serv !== "ASK" && serv !== "NO_GO") return false;
  return r.clauses.some((c) => c.decisive && (restricting as readonly string[]).includes(c.stance));
}

export interface BaselineCell {
  robots_only: RobotsOnly;
  words_restrict: boolean;
}

export interface BaselineCounts {
  pairs: number;
  allowed: number;
  disallowed: number;
  no_robots: number;
  /** The headline: robots.txt allows, the site's own quoted words restrict or forbid. */
  robots_allowed_words_restrict: number;
}

export function baselineCell(r: BaselineReceipt, restricting: readonly Stance[]): BaselineCell {
  return { robots_only: robotsOnly(r), words_restrict: wordsRestrict(r, restricting) };
}

export function baselineCounts(cells: readonly BaselineCell[]): BaselineCounts {
  const n = (v: RobotsOnly) => cells.filter((c) => c.robots_only === v).length;
  return {
    pairs: cells.length,
    allowed: n("allowed"),
    disallowed: n("disallowed"),
    no_robots: n("no_robots"),
    robots_allowed_words_restrict: cells.filter((c) => c.words_restrict).length,
  };
}
