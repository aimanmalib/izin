// Builds what the decider sees: the action, the operator's detail, the signals collected by code
// and only the clauses relevant to this action (at most N, prohibitions first). The same signals
// feed the code ceilings and the receipt, so all three describe one set of facts.
import type { Action, IzinConfig } from "../config.js";
import type { DocReading } from "../baca/reader.js";
import type { ContentSignals, SignalValue } from "../kumpul/robots.js";
import type { Collected, DocKind } from "../kumpul/types.js";
import type { CheckedEvidence } from "../semak/check.js";
import type { VerifiedClause } from "../semak/quotes.js";

export interface DocRef {
  id: string;
  url: string;
  kind: DocKind;
  chars: number;
  truncated: boolean;
}

export interface DeciderSignals {
  robots: {
    fetched: boolean;
    disallow_for_agent: boolean;
    crawl_delay: number | null;
    content_signal: ContentSignals;
  };
  blocked_reader: boolean;
  docs_read: number;
  docs: DocRef[];
  unreadable: { url: string; why: string }[];
  addressed_to_ai_found: boolean;
}

export interface DeciderClause {
  id: string;
  doc: string;
  section: string;
  category: string;
  stance: string;
  quote: string;
}

export interface DeciderInput {
  action: Action;
  action_label: string;
  detail: string | null;
  site: string;
  signals: DeciderSignals;
  clauses: DeciderClause[];
}

/** One value per signal: "no" if any group that applies says no, else "yes" if any says yes. */
export function effectiveSignals(c: Collected): ContentSignals {
  const r = c.robots;
  if (!r) return {};
  const groups = [r.content_signal.izinbot, r.content_signal.any, r.content_signal.agent ?? {}];
  const out: ContentSignals = {};
  for (const key of ["search", "ai-input", "ai-train"] as const) {
    const vals = groups.map((g) => g[key]).filter((v): v is SignalValue => v !== undefined);
    if (vals.includes("no")) out[key] = "no";
    else if (vals.includes("yes")) out[key] = "yes";
  }
  return out;
}

export function robotsDisallows(c: Collected): boolean {
  const d = c.robots?.input_disallowed;
  return !!d && (d.izinbot || d.any || d.agent === true);
}

export function buildSignals(c: Collected, docs: (DocRef & { id: string })[], readings: DocReading[], ev: CheckedEvidence): DeciderSignals {
  const read = new Set(readings.filter((r) => r.status === "read").map((r) => r.doc_id));
  const unreadable = c.signals.unreadable.map((u) => ({ url: u.url, why: u.state as string }));
  for (const r of readings) {
    if (r.status === "read") continue;
    const doc = docs.find((d) => d.id === r.doc_id);
    if (doc) unreadable.push({ url: doc.url, why: r.status === "skipped" ? (r.skip_reason ?? "skipped") : "reader_failed" });
  }
  return {
    robots: {
      fetched: c.robots?.state === "ok",
      disallow_for_agent: robotsDisallows(c),
      crawl_delay: c.robots?.crawl_delay_s ?? null,
      content_signal: effectiveSignals(c),
    },
    blocked_reader: c.signals.blocked.length > 0,
    docs_read: read.size,
    docs,
    unreadable,
    addressed_to_ai_found: ev.signals.addressed_to_ai_found,
  };
}

/** Clauses in the categories that matter for the action, prohibitions first, capped. */
export function relevantClauses(cfg: IzinConfig, action: Action, clauses: VerifiedClause[]): VerifiedClause[] {
  const cats = new Set(cfg.relevance[action]);
  const rank = cfg.decider.stance_priority;
  return clauses
    .filter((c) => cats.has(c.category))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank[a.c.stance]! - rank[b.c.stance]! || a.i - b.i)
    .slice(0, cfg.decider.max_clauses)
    .map(({ c }) => c);
}

export function deciderInput(
  a: { action: Action; action_label: string; detail: string | null; site: string },
  signals: DeciderSignals,
  clauses: VerifiedClause[],
): DeciderInput {
  return {
    ...a,
    signals,
    clauses: clauses.map((c) => ({ id: c.id, doc: c.doc_id, section: c.section, category: c.category, stance: c.stance, quote: c.quote })),
  };
}
