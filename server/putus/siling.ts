// Code ceilings. The final verdict is the strictest of the decider's verdict and every ceiling
// that applies (NO_GO < ASK < GO). Code can only lower a verdict, never raise it, and GO is only
// possible when the decider returned a valid GO. Codes S1 to S11 are listed on every receipt.
import type { Action, Verdict } from "../config.js";
import type { Confidence, Decision } from "./decision.js";
import type { DeciderClause, DeciderSignals } from "./message.js";

/** Actions where silence is not permission: a GO needs a clause quoted from a policy document (S11). */
export const QUOTE_REQUIRED: readonly Action[] = ["crawl", "account", "purchase", "post"];
/** Document kinds that count as the site's policy for S11: fetched terms, or terms the caller pasted. */
const POLICY_KINDS: ReadonlySet<string> = new Set(["policy", "pasted"]);

export type CeilingCode = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11";
export type Flag =
  | "model_disagrees_with_evidence"
  | "unsupported_no_go"
  | "decider_unavailable"
  | "guard_tripped"
  | "bad_citation"
  | "decider_skipped"
  | "shadow_exhausted"
  | "addressed_to_ai";

/** Plain-English pieces the ceilings add to a receipt (from the language file, not from code). */
export interface CeilingTexts {
  ai_input_no: string;
  nothing_read: string;
  reason_decider_skipped: string;
  reason_decider_unavailable: string;
  reason_guard_tripped: string;
  reason_robots: string;
  reason_ai_train: string;
  /** S9 condition when it lowers a GO. */
  ai_text_found: string;
  /** S10 condition; {seconds} is the robots.txt Crawl-delay. */
  crawl_delay_wait: string;
  /** S11 reason; {read} lists what was read (URL and characters), {chars} is the word after a count. */
  reason_no_policy_clause: string;
  /** S11 reason when no terms document was read at all, only robots.txt comments or other pages. */
  reason_no_terms_read: string;
  read_chars: string;
  /** Reason for a read_page GO with no clause from a policy document: written by code, not by the decider. */
  reason_read_page_no_clause: string;
  /** Marks a URL whose text came from robots.txt comments. */
  read_robots_comments: string;
  /** S5 missing lines: the plain-language state of each policy page found but not read. */
  unreadable_why: Record<string, string>;
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

export interface Cap {
  code: CeilingCode;
  cap: Verdict;
}

/** Whether any clause sent to the decider was quoted from a policy document (S11). */
export function quotesPolicy(s: DeciderSignals, clauses: Pick<DeciderClause, "doc">[]): boolean {
  const kind = new Map(s.docs.map((d) => [d.id, d.kind as string]));
  return clauses.some((c) => POLICY_KINDS.has(kind.get(c.doc) ?? ""));
}

/**
 * Ceilings read from the signals and clauses alone, applied after the decision: S9 (text addressed to
 * AI agents was found, so a GO cannot stand), S10 (a crawl where robots.txt sets a Crawl-delay is GO
 * only with a wait between requests, so it is ASK with that condition) and S11 (for crawl, account,
 * purchase and post, a GO with no clause quoted from a policy document rests on silence, so it is ASK;
 * read_page keeps the K7 default). Exported for the re-measure of saved runs.
 */
export function signalCeilings(action: Action, s: DeciderSignals, clauses: Pick<DeciderClause, "doc">[]): Cap[] {
  const caps: Cap[] = [];
  if (s.addressed_to_ai_found) caps.push({ code: "S9", cap: "ASK" });
  if (action === "crawl" && (s.robots.crawl_delay ?? 0) > 0) caps.push({ code: "S10", cap: "ASK" });
  if (QUOTE_REQUIRED.includes(action) && !quotesPolicy(s, clauses)) caps.push({ code: "S11", cap: "ASK" });
  return caps;
}

/** S11 reason: each URL read once, with its size, and that no clause from the site's terms could be quoted. */
function noClauseReason(s: DeciderSignals, t: CeilingTexts): string {
  const byUrl = new Map<string, { chars: number; robots: boolean }>();
  for (const d of s.docs) {
    const e = byUrl.get(d.url) ?? { chars: 0, robots: false };
    byUrl.set(d.url, { chars: e.chars + d.chars, robots: e.robots || d.kind === "robots_comments" });
  }
  const read = [...byUrl]
    .map(([url, e]) => `${url} (${e.chars.toLocaleString("en-US")} ${t.read_chars}${e.robots ? `, ${t.read_robots_comments}` : ""})`)
    .join(", ");
  const terms = s.docs.some((d) => POLICY_KINDS.has(d.kind));
  return (terms ? t.reason_no_policy_clause : t.reason_no_terms_read).replace("{read}", read);
}

const LINE = /^(https?:\/\/\S+) \((.+)\)$/;
const firstUrl = (line: string) => /https?:\/\/[^\s,;()]+/.exec(line)?.[0]?.replace(/[.:]+$/, "");

/**
 * One line per URL in "What we could not read". Lines of the form "URL (state)" for the same URL are joined
 * ("URL (HTTP 403, the page blocked the reader)"); a free-text line about a URL that already has such a line is
 * dropped. `state` turns a stored state code into words (the page uses it for receipts saved before the words).
 */
export function mergeMissing(lines: readonly string[], state: (s: string) => string = (s) => s): string[] {
  const coded = new Set(lines.map((l) => LINE.exec(l)?.[1]).filter(Boolean));
  const out: string[] = [];
  const at = new Map<string, { i: number; states: string[] }>();
  for (const line of lines) {
    const m = LINE.exec(line);
    const url = m?.[1] ?? firstUrl(line);
    if (!url) {
      if (!out.includes(line)) out.push(line);
      continue;
    }
    if (!m && coded.has(url)) continue;
    const words = m ? m[2]!.split(", ").map(state) : [];
    const seen = at.get(url);
    if (!seen) {
      at.set(url, { i: out.length, states: words });
      out.push(m ? `${url} (${words.join(", ")})` : line);
      continue;
    }
    for (const w of words) if (!seen.states.includes(w)) seen.states.push(w);
    if (m) out[seen.i] = `${url} (${seen.states.join(", ")})`;
  }
  return out;
}

const ORDER: Verdict[] = ["NO_GO", "ASK", "GO"];
export const strictest = (...vs: Verdict[]): Verdict => ORDER[Math.min(...vs.map((v) => ORDER.indexOf(v)))]!;

export function applyCeilings(input: CeilingInput, t: CeilingTexts): Outcome {
  const { action, signals: s, decision } = input;
  const caps: Cap[] = [];
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
    for (const u of s.unreadable) addMissing(`${u.url} (${t.unreadable_why[u.why] ?? u.why})`);
  }

  const known = new Map(input.clauses.map((c) => [c.id, c]));
  const prohibits = input.clauses.filter((c) => c.stance === "prohibits");
  const signalApplies = caps.some((c) => c.code === "S1" || c.code === "S2");
  let decisive = decision?.decisive_clause_ids ?? [];

  if (!decision && input.decider === "skipped") {
    // Nothing was read, or no clause at all for an S11 action: no decision was requested; S5 or S11 caps at ASK.
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

  const late = signalCeilings(action, s, input.clauses);
  caps.push(...late);
  if (late.some((c) => c.code === "S9")) {
    flags.push("addressed_to_ai");
    if (decision?.verdict === "GO" && !conditions.includes(t.ai_text_found)) conditions.push(t.ai_text_found);
  }
  if (late.some((c) => c.code === "S10")) {
    const wait = t.crawl_delay_wait.replace("{seconds}", String(s.robots.crawl_delay));
    if (!conditions.includes(wait)) conditions.push(wait);
  }

  // S7 is the one ceiling that replaces the decider's verdict instead of capping it.
  const servVerdict = decision?.verdict ?? null;
  const base: Verdict = !servVerdict ? "ASK" : caps.some((c) => c.code === "S7") ? "ASK" : servVerdict;
  const final = strictest(base, ...caps.map((c) => c.cap));

  let confidence: Confidence = decision?.confidence ?? "low";
  const ceilings = [...new Set(caps.map((c) => c.code))];
  if (s.addressed_to_ai_found) confidence = "low";

  let reason = decision?.reason ?? "";
  if (!decision) reason = input.decider === "skipped" ? t.reason_decider_skipped : input.decider === "guard_tripped" ? t.reason_guard_tripped : t.reason_decider_unavailable;
  const s11 = late.some((c) => c.code === "S11");
  if (s11 && s.docs_read > 0 && (servVerdict === "GO" || (!decision && input.decider === "skipped"))) reason = noClauseReason(s, t);
  if (action === "read_page" && final === "GO" && s.robots.fetched && !quotesPolicy(s, input.clauses)) reason = t.reason_read_page_no_clause;
  if (final === "NO_GO" && servVerdict !== "NO_GO") reason = caps.some((c) => c.code === "S2") ? t.reason_ai_train : t.reason_robots;

  return { serv_verdict: servVerdict, ceilings, final, flags, confidence, reason, conditions, missing: mergeMissing(missing, (w) => t.unreadable_why[w] ?? w), decisive_clause_ids: decisive };
}
