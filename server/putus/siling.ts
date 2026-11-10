// Code ceilings. The final verdict is the strictest of the decider's verdict and every ceiling
// that applies (NO_GO < ASK < GO). Code can only lower a verdict, never raise it, and GO is only
// possible when the decider returned a valid GO. Codes S1 to S9 are listed on every receipt.
import type { Action, Verdict } from "../config.js";
import type { Confidence, Decision } from "./decision.js";
import type { DeciderClause, DeciderSignals } from "./message.js";

export type CeilingCode = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";
export type Flag =
  | "model_disagrees_with_evidence"
  | "unsupported_no_go"
  | "decider_unavailable"
  | "guard_tripped"
  | "bad_citation"
  | "decider_skipped"
  | "shadow_exhausted";

/** Plain-English pieces the ceilings add to a receipt (from the language file, not from code). */
export interface CeilingTexts {
  ai_input_no: string;
  nothing_read: string;
  reason_decider_skipped: string;
  reason_decider_unavailable: string;
  reason_guard_tripped: string;
  reason_robots: string;
  reason_ai_train: string;
}

export interface CeilingInput {
  action: Action;
  signals: DeciderSignals;
  /** Blocked home or policy pages (S4). */
  blocked: { url: string; status: number }[];
  /** The clauses sent to the decider. */
  clauses: DeciderClause[];
  /** Null when no decision was requested (nothing was read) or none came back. */
  decision: Decision | null;
  decider: "ok" | "skipped" | "unavailable" | "guard_tripped";
  shadow_exhausted?: boolean;
}

export interface Outcome {
  serv_verdict: Verdict | null;
  ceilings: CeilingCode[];
  final: Verdict;
  flags: Flag[];
  confidence: Confidence;
  reason: string;
  conditions: string[];
  missing: string[];
  decisive_clause_ids: string[];
}

const ORDER: Verdict[] = ["NO_GO", "ASK", "GO"];
export const strictest = (...vs: Verdict[]): Verdict => ORDER[Math.min(...vs.map((v) => ORDER.indexOf(v)))]!;

export function applyCeilings(input: CeilingInput, t: CeilingTexts): Outcome {
  const { action, signals: s, decision } = input;
  const caps: { code: CeilingCode; cap: Verdict }[] = [];
  const flags: Flag[] = [];
  const conditions = [...(decision?.conditions ?? [])];
  const missing = [...(decision?.missing ?? [])];
  const addMissing = (m: string) => {
    if (!missing.includes(m)) missing.push(m);
  };

  // S1: robots.txt disallows the URL for IzinBot, for "*", or for the caller's agent token.
  if (s.robots.disallow_for_agent && (action === "crawl" || action === "read_page")) caps.push({ code: "S1", cap: action === "crawl" ? "NO_GO" : "ASK" });
  // S2 and S3: Content Signals.
  if (action === "train" && s.robots.content_signal["ai-train"] === "no") caps.push({ code: "S2", cap: "NO_GO" });
  if (action === "read_page" && s.robots.content_signal["ai-input"] === "no") {
    caps.push({ code: "S3", cap: "ASK" });
    if (!conditions.includes(t.ai_input_no)) conditions.push(t.ai_input_no);
  }
  // S4: a home or policy page answered with a block or a challenge.
  if (input.blocked.length) {
    caps.push({ code: "S4", cap: "ASK" });
    for (const b of input.blocked) addMissing(`${b.url} (HTTP ${b.status})`);
  }
  // S5: nothing read, or something not read in full.
  if (s.docs_read === 0 || s.unreadable.length) {
    caps.push({ code: "S5", cap: "ASK" });
    if (s.docs_read === 0) addMissing(t.nothing_read);
    for (const u of s.unreadable) addMissing(`${u.url} (${u.why})`);
  }

  const known = new Map(input.clauses.map((c) => [c.id, c]));
  const prohibits = input.clauses.filter((c) => c.stance === "prohibits");
  const signalApplies = caps.some((c) => c.code === "S1" || c.code === "S2");
  let decisive = decision?.decisive_clause_ids ?? [];

  if (!decision && input.decider === "skipped") {
    // Nothing was read, so no decision was requested; S5 already caps the verdict at ASK.
    flags.push("decider_skipped");
  } else if (!decision) {
    caps.push({ code: "S8", cap: "ASK" });
    flags.push(input.decider === "guard_tripped" ? "guard_tripped" : "decider_unavailable");
  } else {
    if (decisive.some((id) => !known.has(id))) {
      caps.push({ code: "S8", cap: "ASK" });
      flags.push("bad_citation");
      decisive = decisive.filter((id) => known.has(id));
    }
    if (decision.verdict === "GO" && prohibits.length) {
      caps.push({ code: "S6", cap: "ASK" });
      flags.push("model_disagrees_with_evidence");
    }
    const citesProhibition = decisive.some((id) => known.get(id)?.stance === "prohibits");
    if (decision.verdict === "NO_GO" && !citesProhibition && !signalApplies) {
      caps.push({ code: "S7", cap: "ASK" });
      flags.push("unsupported_no_go");
    }
  }
  if (input.shadow_exhausted) flags.push("shadow_exhausted");

  // S7 is the one ceiling that replaces the decider's verdict instead of capping it.
  const servVerdict = decision?.verdict ?? null;
  const base: Verdict = !servVerdict ? "ASK" : caps.some((c) => c.code === "S7") ? "ASK" : servVerdict;
  const final = strictest(base, ...caps.map((c) => c.cap));

  let confidence: Confidence = decision?.confidence ?? "low";
  const ceilings = [...new Set(caps.map((c) => c.code))];
  if (s.addressed_to_ai_found) {
    confidence = "low";
    ceilings.push("S9");
  }

  let reason = decision?.reason ?? "";
  if (!decision) reason = input.decider === "skipped" ? t.reason_decider_skipped : input.decider === "guard_tripped" ? t.reason_guard_tripped : t.reason_decider_unavailable;
  if (final === "NO_GO" && servVerdict !== "NO_GO") reason = caps.some((c) => c.code === "S2") ? t.reason_ai_train : t.reason_robots;

  return { serv_verdict: servVerdict, ceilings, final, flags, confidence, reason, conditions, missing, decisive_clause_ids: decisive };
}
