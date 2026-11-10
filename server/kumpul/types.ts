// Shapes produced by the collector and consumed by the reader, ceilings and receipt.
import type { FetchState } from "./fetch.js";
import type { ContentSignals } from "./robots.js";

export type FetchKind = "robots" | "input" | "home" | "policy";
export type LedgerState =
  | Exclude<FetchState, "ok">
  | "ok"
  | "robots_disallow"
  | "needs_browser"
  | "truncated"
  | "not_fetched";

/** One line per request Izin made (or deliberately did not make) during a check. */
export interface LedgerEntry {
  url: string;
  final_url: string;
  kind: FetchKind;
  status: number;
  bytes: number;
  sha256: string | null;
  at: string;
  state: LedgerState;
  note?: string;
}

export type DocKind = "policy" | "robots_comments" | "pasted";

export interface PolicyDoc {
  kind: DocKind;
  url: string;
  text: string;
  state: "ok" | "truncated" | "needs_browser";
  /** False when the site signals ai-input=no: the text must not reach any model. */
  to_model: boolean;
  /** Pasted text: the requester supplied it and its origin is not verified. */
  origin_verified: boolean;
}

export interface RobotsSummary {
  url: string;
  state: "ok" | "none" | LedgerState;
  crawl_delay_s?: number;
  /** Whether robots.txt disallows the input URL for IzinBot, for the "*" group and for the optional agent token. */
  input_disallowed: { izinbot: boolean; any: boolean; agent?: boolean };
  content_signal: { izinbot: ContentSignals; any: ContentSignals; agent?: ContentSignals };
  /** The standard Content Signals preamble was present (a template, not the site's stance). */
  boilerplate_found: boolean;
}

export interface Collected {
  input_url: string;
  site: string;
  mode: "fetch" | "paste" | "do_not_fetch";
  agent?: string;
  robots: RobotsSummary | null;
  docs: PolicyDoc[];
  ledger: LedgerEntry[];
  requests_used: number;
  signals: {
    docs_read: number;
    /** Policy documents found but not readable in full (dead links are not counted). */
    unreadable: { url: string; state: LedgerState }[];
    /** Home or policy pages that answered with a block or a challenge. */
    blocked: { url: string; kind: FetchKind; status: number }[];
    ai_input_no: boolean;
    do_not_fetch: boolean;
  };
}
