// The receipt: everything one check found and decided, in a stable JSON shape. Its hash is the
// sha256 of canonical JSON (keys sorted at every level) of the receipt without the hash field,
// so anyone can recompute it from the JSON the API serves.
import { createHash, randomBytes } from "node:crypto";
import type { Action, IzinConfig, Verdict } from "../config.js";
import type { DocReading } from "../baca/reader.js";
import type { Collected, FetchKind, LedgerState } from "../kumpul/types.js";
import type { CheckedEvidence } from "../semak/check.js";
import type { Confidence } from "../putus/decision.js";
import type { DeciderSignals, DocRef } from "../putus/message.js";
import type { DeciderResult, Rung } from "../putus/serv.js";
import type { CeilingCode, Flag, Outcome } from "../putus/siling.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newReceiptId(length: number, bytes: (n: number) => Buffer = randomBytes): string {
  const b = bytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += BASE32[b[i]! & 31];
  return out;
}

/** JSON with object keys sorted at every level; arrays keep their order. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
}

export function receiptHash(r: Omit<Receipt, "receipt_sha256"> | Receipt): string {
  const rest: Record<string, unknown> = { ...r };
  delete rest.receipt_sha256;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export interface ReceiptClause {
  id: string;
  doc: string;
  section: string;
  category: string;
  stance: string;
  quote: string;
  source_url: string;
  fragment_url: string | null;
  decisive: boolean;
}

export interface Receipt {
  id: string;
  created_at: string;
  site: string;
  url: string;
  action: Action;
  detail: string | null;
  verdict: Verdict;
  reason: string;
  conditions: string[];
  missing: string[];
  confidence: Confidence;
  rules_applied: string[];
  decided_by: { serv_verdict: Verdict | null; ceilings: CeilingCode[]; final: Verdict; flags: Flag[] };
  clauses: ReceiptClause[];
  quarantined: { doc: string; text: string }[];
  signals: DeciderSignals & {
    mode: Collected["mode"];
    ai_input_no: boolean;
    do_not_fetch: boolean;
    robots_stop: Collected["signals"]["robots_stop"];
  };
  fetched: { scope: FetchScope; label: string };
  fetch_ledger: { url: string; status: number; bytes: number; sha256: string | null; fetched_at: string; kind: FetchKind; state: LedgerState }[];
  reader: {
    provider: string | null;
    model: string | null;
    prompt_version: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    ms: number;
    fallback_reason?: string;
    per_doc: { doc: string; reader: string | null; status: DocReading["status"]; cached: boolean }[];
  };
  decider: {
    model: string | null;
    config_rung: Rung | null;
    prompt_version: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd_estimated: number | null;
    ms: number;
    request_id?: string;
  };
  dropped_quotes: number;
  totals: { cost_usd_estimated: number | null; ms: number };
  cached: { hit: boolean; age_s: number };
  version: string;
  disclaimer: string;
  receipt_sha256: string;
}

export interface ReceiptParts {
  id: string;
  created_at: string;
  action: Action;
  detail: string | null;
  collected: Collected;
  docs: DocRef[];
  readings: DocReading[];
  evidence: CheckedEvidence;
  signals: DeciderSignals;
  decider: DeciderResult | null;
  outcome: Outcome;
  rules_applied: string[];
  ms_total: number;
  disclaimer: string;
  fetched_labels: FetchedLabels;
}

export type FetchScope = "robots_only" | "pages" | "none";
export type FetchedLabels = Record<FetchScope, string>;

/** What Izin fetched from the site, from the ledger: nothing, robots.txt only, or pages too. */
export function fetchScope(c: Collected): FetchScope {
  if (!c.ledger.length) return "none";
  return c.ledger.every((e) => e.kind === "robots") ? "robots_only" : "pages";
}

function readerSummary(cfg: IzinConfig, readings: DocReading[]): Receipt["reader"] {
  const attempts = readings.flatMap((r) => r.attempts);
  const firstOk = attempts.find((a) => a.outcome === "ok");
  const fallback = readings.filter((r) => r.status === "read" && r.fail_reasons.length).flatMap((r) => r.fail_reasons);
  return {
    provider: firstOk?.provider ?? null,
    model: firstOk?.model ?? null,
    prompt_version: cfg.reader.prompt,
    tokens_in: attempts.reduce((s, a) => s + (a.input_tokens ?? 0), 0),
    tokens_out: attempts.reduce((s, a) => s + (a.output_tokens ?? 0), 0),
    cost_usd: readings.reduce((s, r) => s + r.cost_usd, 0),
    ms: attempts.reduce((s, a) => s + a.ms, 0),
    ...(fallback.length ? { fallback_reason: [...new Set(fallback)].join(", ") } : {}),
    per_doc: readings.map((r) => ({ doc: r.doc_id, reader: r.reader, status: r.status, cached: r.cached })),
  };
}

export function buildReceipt(cfg: IzinConfig, p: ReceiptParts): Receipt {
  const { collected: c, outcome: o, decider: d } = p;
  const docUrl = new Map(p.docs.map((x) => [x.id, x.url]));
  const decisive = new Set(o.decisive_clause_ids);
  const reader = readerSummary(cfg, p.readings);
  const deciderCost = d ? d.cost_usd_estimated : 0;
  const scope = fetchScope(c);
  const body: Omit<Receipt, "receipt_sha256"> = {
    id: p.id,
    created_at: p.created_at,
    site: c.site,
    url: c.input_url,
    action: p.action,
    detail: p.detail,
    verdict: o.final,
    reason: o.reason,
    conditions: o.conditions,
    missing: o.missing,
    confidence: o.confidence,
    rules_applied: p.rules_applied,
    decided_by: { serv_verdict: o.serv_verdict, ceilings: o.ceilings, final: o.final, flags: o.flags },
    clauses: p.evidence.clauses.map((k) => ({
      id: k.id,
      doc: k.doc_id,
      section: k.section,
      category: k.category,
      stance: k.stance,
      quote: k.quote,
      source_url: docUrl.get(k.doc_id) ?? c.input_url,
      fragment_url: k.link,
      decisive: decisive.has(k.id),
    })),
    quarantined: p.evidence.quarantined.map((q) => ({ doc: q.doc_id, text: q.text })),
    signals: {
      ...p.signals,
      mode: c.mode,
      ai_input_no: c.signals.ai_input_no,
      do_not_fetch: c.signals.do_not_fetch,
      robots_stop: c.signals.robots_stop,
    },
    fetched: { scope, label: p.fetched_labels[scope] },
    fetch_ledger: c.ledger.map((e) => ({ url: e.url, status: e.status, bytes: e.bytes, sha256: e.sha256, fetched_at: e.at, kind: e.kind, state: e.state })),
    reader,
    decider: {
      model: d?.model ?? null,
      config_rung: d?.rung ?? null,
      prompt_version: d?.prompt_version ?? cfg.decider.prompt,
      tokens_in: d?.tokens_in ?? 0,
      tokens_out: d?.tokens_out ?? 0,
      cost_usd_estimated: deciderCost,
      ms: d?.ms ?? 0,
      ...(d?.request_id ? { request_id: d.request_id } : {}),
    },
    dropped_quotes: p.evidence.counts.dropped_quotes,
    totals: { cost_usd_estimated: deciderCost === null ? null : round6(reader.cost_usd + deciderCost), ms: p.ms_total },
    cached: { hit: false, age_s: 0 },
    version: cfg.receipt.version,
    disclaimer: p.disclaimer,
  };
  return { ...body, receipt_sha256: receiptHash(body) };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
