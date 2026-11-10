// G1 measurement plan, without network: which documents are read, which decider payloads are
// sent, what the run is expected to cost, and the summary numbers once results are in.
// scripts/g1.ts does the calls; this module is pure so it can be tested offline.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ACTIONS, type Action, type IzinConfig } from "../../server/config.js";
import type { ReaderOutput } from "../../server/baca/types.js";
import type { DocKind } from "../../server/kumpul/types.js";
import { checkEvidence } from "../../server/semak/check.js";
import { verifyDocClauses } from "../../server/semak/quotes.js";
import { deciderInput, relevantClauses, type DeciderInput } from "../../server/putus/message.js";

export const g1ConfigSchema = z.object({
  real_sites: z.array(z.string().min(1)).min(1),
  real_docs: z.number().int().positive(),
  normal_payloads: z.number().int().positive(),
  guard_normal_payloads: z.number().int().positive(),
  thresholds: z.object({
    g1c_json_ok_min: z.number().int().positive(),
    g1d_quotes_pass_min: z.number().min(0).max(1),
    g1e_median_ms_max: z.number().positive(),
    g1e_doc_tokens_max: z.number().positive(),
    g1f_schema_ok_min: z.number().int().positive(),
    g1g_traps_refused_min: z.number().int().nonnegative(),
    g1g_false_positive_per_10_max: z.number().nonnegative(),
  }),
  estimate: z.object({
    chars_per_token: z.number().positive(),
    real_doc_tokens_assumed: z.number().positive(),
    decider_output_tokens_assumed: z.number().positive(),
    decider_calls_per_payload_assumed: z.number().positive(),
  }),
  caps_usd: z.object({ serv: z.number().positive(), dolphin: z.number().positive() }),
  raw_out: z.string(),
  report_out: z.string(),
});
export type G1Config = z.infer<typeof g1ConfigSchema>;

const syntheticSchema = z.object({
  docs: z.array(z.object({ id: z.string(), url: z.string().url(), text: z.string().min(1) })).min(1),
  trap_payloads: z
    .array(
      z.object({
        id: z.string(),
        action: z.enum(ACTIONS),
        detail: z.string().nullable(),
        doc: z.string(),
        extra_clause: z.object({ section: z.string(), category: z.string(), stance: z.string(), quote: z.string() }).optional(),
      }),
    )
    .min(1),
});
export type Synthetic = z.infer<typeof syntheticSchema>;

export function loadG1(path = "config/g1.json"): G1Config {
  return g1ConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadSynthetic(path = "fixtures/g1/synthetic.json"): Synthetic {
  const s = syntheticSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set(s.docs.map((d) => d.id));
  for (const t of s.trap_payloads) if (!ids.has(t.doc)) throw new Error(`trap payload ${t.id} names unknown doc ${t.doc}`);
  return s;
}

export interface G1Doc {
  id: string;
  source: "real" | "synthetic";
  url: string;
  kind: DocKind;
  text: string;
}

export interface Payload {
  id: string;
  kind: "normal" | "trap";
  action: Action;
  doc_id: string;
  input: DeciderInput;
}

/** Quote check of one reading: how many quotes the reader returned and how many are word for word in the text. */
export function quoteCounts(cfg: IzinConfig, doc: G1Doc, out: ReaderOutput): { returned: number; kept: number; dropped_enum: number } {
  const v = verifyDocClauses({ id: "d1", kind: doc.kind, url: doc.url, text: doc.text }, out, cfg);
  const considered = Math.min(out.clauses.length, cfg.reader.max_clauses);
  return { returned: considered - v.counts.dropped_enum, kept: v.clauses.length, dropped_enum: v.counts.dropped_enum };
}

/** The message the decider would get for this document and action, signals as for a one-document check. */
export function payloadFor(
  cfg: IzinConfig,
  labels: Record<Action, string>,
  doc: G1Doc,
  out: ReaderOutput | null,
  action: Action,
  detail: string | null,
  extra?: Synthetic["trap_payloads"][number]["extra_clause"],
): DeciderInput {
  const ev = checkEvidence([{ doc: { id: "d1", kind: doc.kind, url: doc.url, text: doc.text }, output: out }], cfg);
  const clauses = relevantClauses(cfg, action, ev.clauses);
  const signals = {
    robots: { fetched: true, disallow_for_agent: false, crawl_delay: null, content_signal: {} },
    blocked_reader: false,
    docs_read: out ? 1 : 0,
    docs: [{ id: "d1", url: doc.url, kind: doc.kind, chars: doc.text.length, truncated: false }],
    unreadable: out ? [] : [{ url: doc.url, why: "reader_failed" }],
    addressed_to_ai_found: ev.signals.addressed_to_ai_found,
  };
  const input = deciderInput({ action, action_label: labels[action], detail, site: new URL(doc.url).hostname }, signals, clauses);
  if (extra) input.clauses.push({ id: `c${input.clauses.length + 1}`, doc: "d1", ...extra });
  return input;
}

/** Normal payloads: each document with two actions in turn, so all six actions appear. */
export function normalPayloads(
  cfg: IzinConfig,
  labels: Record<Action, string>,
  docs: { doc: G1Doc; out: ReaderOutput | null }[],
  count: number,
): Payload[] {
  const out: Payload[] = [];
  for (let i = 0; out.length < count && docs.length > 0; i++) {
    const { doc, out: reading } = docs[Math.floor(i / 2) % docs.length]!;
    const action = ACTIONS[i % ACTIONS.length]!;
    out.push({ id: `n${out.length + 1}`, kind: "normal", action, doc_id: doc.id, input: payloadFor(cfg, labels, doc, reading, action, null) });
  }
  return out;
}

export function trapPayloads(
  cfg: IzinConfig,
  labels: Record<Action, string>,
  syn: Synthetic,
  docs: { doc: G1Doc; out: ReaderOutput | null }[],
): Payload[] {
  return syn.trap_payloads.map((t) => {
    const d = docs.find((x) => x.doc.id === t.doc);
    if (!d) throw new Error(`trap payload ${t.id}: document ${t.doc} not in the run`);
    return { id: t.id, kind: "trap", action: t.action, doc_id: t.doc, input: payloadFor(cfg, labels, d.doc, d.out, t.action, t.detail, t.extra_clause) };
  });
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Estimate {
  dolphin_usd: number;
  serv_usd: number;
  reads: number;
  decider_payloads: number;
}

/** Upper estimate before any call: assumed sizes from config/g1.json, listed prices, SERV factor. */
export function estimate(cfg: IzinConfig, g1: G1Config, syn: Synthetic, promptChars: { reader: number; decider: number }): Estimate {
  const e = g1.estimate;
  const dPrice = Object.values(cfg.prices_usd_per_mtok.dolphin)[0] ?? { input: 0, output: 0 };
  const synTokens = syn.docs.reduce((s, d) => s + d.text.length / e.chars_per_token, 0);
  const readIn = g1.real_docs * e.real_doc_tokens_assumed + synTokens + (g1.real_docs + syn.docs.length) * (promptChars.reader / e.chars_per_token);
  // Each document may be read twice (one retry on bad JSON) and may use the whole output cap.
  const reads = g1.real_docs + syn.docs.length;
  const dolphin = (2 * readIn * dPrice.input + 2 * reads * cfg.reader.max_tokens * dPrice.output) / 1_000_000;
  const base = cfg.decider.model.endsWith(cfg.decider.suffix) ? cfg.decider.model.slice(0, -cfg.decider.suffix.length) : cfg.decider.model;
  const sPrice = cfg.prices_usd_per_mtok.serv[base] ?? { input: 0, output: 0 };
  const payloads = g1.normal_payloads + syn.trap_payloads.length + g1.guard_normal_payloads;
  const perCallIn = (promptChars.decider + cfg.decider.max_clauses * cfg.limits.quote_max_chars) / e.chars_per_token;
  const calls = payloads * e.decider_calls_per_payload_assumed;
  const serv = ((calls * (perCallIn * sPrice.input + e.decider_output_tokens_assumed * sPrice.output)) / 1_000_000) * cfg.budget.serv_cost_factor;
  return { dolphin_usd: dolphin, serv_usd: serv, reads, decider_payloads: payloads };
}
