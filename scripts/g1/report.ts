// G1 results: the rows the run collects, the pass/fail summary against config/g1.json, and the
// public report (docs/UKUR-G1.md). The report holds numbers and response shapes only: no keys,
// no policy text, no request ids.
import type { G1Config } from "./plan.js";
import { median } from "./plan.js";

export interface ReadRow {
  doc_id: string;
  source: "real" | "synthetic";
  host: string;
  chars: number;
  est_tokens: number;
  json_ok: boolean;
  retried: boolean;
  error: string | null;
  ms: number;
  ttft_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  reasoning_deltas: number;
  quotes_returned: number;
  quotes_kept: number;
  cost_usd: number;
  response_model: string | null;
  fallback_suspected: boolean;
}

export interface ReplyShape {
  refusal: string | null;
  finish_reason: string | null;
  content_head: string;
  /** Names of response headers and non-standard body fields; values are not reported. */
  extra_keys: string[];
}

export interface DecisionRow {
  id: string;
  kind: "normal" | "trap" | "guard_normal";
  /** Prompt Guard declared on this payload. */
  guard: boolean;
  action: string;
  doc_id: string;
  outcome: string;
  first_rung_outcome: string;
  rung: string;
  calls: number;
  verdict: string | null;
  schema_ok: boolean;
  guard_tripped: boolean;
  shadow_exhausted: boolean;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_estimated: number | null;
  shape: ReplyShape | null;
}

export interface G1Result {
  run_at: string;
  user_agent: string;
  reader: { provider: string; model: string; max_tokens: number; reasoning_effort: string | null };
  decider: { model: string; reasoning_effort: string; serv_cost_factor: number; guard: "always" | "flagged" };
  g1a: { serv_models_status: number | null; serv_first_call_status: number | null };
  g1b: { dolphin_models_status: number | null; models_listed: number; reader_listed: boolean; first_call_status: number | null };
  real_sites: { host: string; doc: boolean; note: string }[];
  reads: ReadRow[];
  decisions: DecisionRow[];
}

export interface G1Summary {
  g1a: boolean;
  g1b: boolean;
  g1c: { ok: number; of: number; pass: boolean };
  g1d: { kept: number; returned: number; rate: number | null; pass: boolean };
  g1e: { median_ms: number | null; docs: number; pass: boolean };
  g1f: { schema_ok: number; of: number; first_rung_ok: number; pass: boolean };
  g1g: { traps_refused: number; traps: number; false_positives: number; normal: number; per_10: number | null; pass: boolean };
  g1h: { serv_usd_estimated: number; per_decision_usd: number | null; serv_tokens_in: number; serv_tokens_out: number; dolphin_usd: number };
  reasoning: { reasoning_tokens: number | null; reasoning_deltas: number; max_output_tokens: number | null; at_cap: number };
}

export function summarise(r: G1Result, g1: G1Config): G1Summary {
  const t = g1.thresholds;
  const c = r.reads.filter((x) => x.json_ok).length;
  const kept = r.reads.reduce((s, x) => s + x.quotes_kept, 0);
  const returned = r.reads.reduce((s, x) => s + x.quotes_returned, 0);
  const rate = returned ? kept / returned : null;
  const timed = r.reads.filter((x) => x.json_ok && x.est_tokens <= t.g1e_doc_tokens_max);
  const med = median(timed.map((x) => x.ms));
  const normal = r.decisions.filter((d) => d.kind === "normal");
  const traps = r.decisions.filter((d) => d.kind === "trap");
  const schemaOk = normal.filter((d) => d.schema_ok).length;
  const guardNormal = r.decisions.filter((d) => d.kind === "guard_normal");
  const fp = guardNormal.filter((d) => d.guard_tripped).length;
  const per10 = guardNormal.length ? (fp / guardNormal.length) * 10 : null;
  const refused = traps.filter((d) => d.guard_tripped).length;
  const servUsd = r.decisions.reduce((s, d) => s + (d.cost_usd_estimated ?? 0), 0);
  const decided = r.decisions.filter((d) => d.input_tokens > 0).length;
  const reasoningKnown = r.reads.filter((x) => x.reasoning_tokens !== null);
  const outs = r.reads.map((x) => x.output_tokens).filter((x): x is number => x !== null);
  return {
    g1a: r.g1a.serv_first_call_status === 200,
    g1b: r.g1b.reader_listed && r.g1b.first_call_status === 200,
    g1c: { ok: c, of: r.reads.length, pass: c >= t.g1c_json_ok_min },
    g1d: { kept, returned, rate, pass: rate !== null && rate >= t.g1d_quotes_pass_min },
    g1e: { median_ms: med, docs: timed.length, pass: med !== null && med <= t.g1e_median_ms_max },
    g1f: { schema_ok: schemaOk, of: normal.length, first_rung_ok: normal.filter((d) => d.first_rung_outcome === "ok").length, pass: schemaOk >= t.g1f_schema_ok_min },
    g1g: {
      traps_refused: refused,
      traps: traps.length,
      false_positives: fp,
      normal: guardNormal.length,
      per_10: per10,
      pass: refused >= t.g1g_traps_refused_min && per10 !== null && per10 <= t.g1g_false_positive_per_10_max,
    },
    g1h: {
      serv_usd_estimated: servUsd,
      per_decision_usd: decided ? servUsd / decided : null,
      serv_tokens_in: r.decisions.reduce((s, d) => s + d.input_tokens, 0),
      serv_tokens_out: r.decisions.reduce((s, d) => s + d.output_tokens, 0),
      dolphin_usd: r.reads.reduce((s, x) => s + x.cost_usd, 0),
    },
    reasoning: {
      reasoning_tokens: reasoningKnown.length ? reasoningKnown.reduce((s, x) => s + x.reasoning_tokens!, 0) : null,
      reasoning_deltas: r.reads.reduce((s, x) => s + x.reasoning_deltas, 0),
      max_output_tokens: outs.length ? Math.max(...outs) : null,
      at_cap: outs.filter((o) => o >= r.reader.max_tokens).length,
    },
  };
}

const yes = (b: boolean) => (b ? "pass" : "fail");
const usd = (n: number | null) => (n === null ? "n/a" : `USD ${n.toFixed(4)}`);
const s = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

/** One line per distinct reply shape, with the payloads that got it and their token usage. */
function shapeLines(rows: DecisionRow[]): string[] {
  const groups = new Map<string, DecisionRow[]>();
  for (const d of rows.filter((x) => x.shape)) {
    const sh = d.shape!;
    const key = JSON.stringify([d.outcome, sh.refusal, sh.finish_reason, sh.content_head.replace(/\s+/g, " ").slice(0, 160), sh.extra_keys]);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const out: string[] = [];
  for (const ds of groups.values()) {
    const d = ds[0]!;
    const sh = d.shape!;
    const usage = ds.every((x) => x.input_tokens === 0 && x.output_tokens === 0) ? "usage 0 in / 0 out" : "usage reported";
    out.push(
      `- Outcome \`${d.outcome}\` on ${ds.map((x) => `${x.id} (${x.kind})`).join(", ")}: \`message.refusal\` ${sh.refusal === null ? "null" : `"${sh.refusal.slice(0, 160)}"`}, \`message.content\` "${sh.content_head.replace(/\s+/g, " ").slice(0, 160)}", finish_reason \`${sh.finish_reason ?? "null"}\`, ${usage}. Response header and extra field names: ${sh.extra_keys.join(", ") || "none"}.`,
    );
  }
  return out.length ? out : ["- No reply in this run was a refusal or an unusable answer."];
}

/** What config holds after this run, stated next to the numbers that led to it. */
function settingLines(r: G1Result, sum: G1Summary): string[] {
  return [
    `- Reader \`reasoning_effort\`: ${r.reader.reasoning_effort ?? "not sent"}; \`max_tokens\` ${r.reader.max_tokens}.`,
    r.decider.guard === "flagged"
      ? `- Prompt Guard mode \`flagged\`: declared only when the code filter (\`injection_patterns\`) flags the detail or a clause${sum.g1g.pass ? "" : `, because declared on every request it refused ${sum.g1g.false_positives} of ${sum.g1g.normal} normal payloads (G1g)`}. A guard refusal still ends in ASK.`
      : "- Prompt Guard mode `always`: declared on every decider request.",
    `- Decider time per payload (G1f): median ${s(median(r.decisions.filter((d) => d.kind === "normal").map((d) => d.ms)))}, longest ${s(Math.max(0, ...r.decisions.filter((d) => d.kind === "normal").map((d) => d.ms)))}.`,
  ];
}

export function renderReport(r: G1Result, g1: G1Config, sum: G1Summary): string {
  const t = g1.thresholds;
  const lines = [
    "# G1 measurements",
    "",
    `Run ${r.run_at} by \`scripts/g1.ts\`. Reader: ${r.reader.provider} \`${r.reader.model}\` (streamed, max_tokens ${r.reader.max_tokens}).`,
    `Decider: SERV \`${r.decider.model}\`, reasoning_effort ${r.decider.reasoning_effort}, strict schema and Shadow Agent (rung a); Prompt Guard as stated below.`,
    `Pages were fetched with \`${r.user_agent}\`, one collector pass per site. No policy text is stored in this repository.`,
    "",
    "| Gate | Measure | Threshold | Result | |",
    "|---|---|---|---|---|",
    `| G1a | SERV key, first call | HTTP 200 | GET /models ${r.g1a.serv_models_status ?? "n/a"}, first decision call ${r.g1a.serv_first_call_status ?? "n/a"} | ${yes(sum.g1a)} |`,
    `| G1b | Dolphin key, reader model listed, first call | listed, HTTP 200 | GET /models ${r.g1b.dolphin_models_status ?? "n/a"} (${r.g1b.models_listed} models, reader ${r.g1b.reader_listed ? "listed" : "not listed"}), first read ${r.g1b.first_call_status ?? "n/a"} | ${yes(sum.g1b)} |`,
    `| G1c | Valid JSON from the reader (tolerant parser + 1 retry) | ≥ ${t.g1c_json_ok_min}/10 | ${sum.g1c.ok}/${sum.g1c.of} | ${yes(sum.g1c.pass)} |`,
    `| G1d | Returned quotes found word for word | ≥ ${pct(t.g1d_quotes_pass_min)} | ${sum.g1d.kept}/${sum.g1d.returned} (${pct(sum.g1d.rate)}) | ${yes(sum.g1d.pass)} |`,
    `| G1e | Reader latency, documents ≤ ${t.g1e_doc_tokens_max.toLocaleString("en")} tokens | median ≤ ${s(t.g1e_median_ms_max)} | median ${s(sum.g1e.median_ms)} over ${sum.g1e.docs} documents | ${yes(sum.g1e.pass)} |`,
    `| G1f | Decider answers valid for the strict schema | ${t.g1f_schema_ok_min}/${g1.normal_payloads} | ${sum.g1f.schema_ok}/${sum.g1f.of} (${sum.g1f.first_rung_ok} on the first call at rung a) | ${yes(sum.g1f.pass)} |`,
    `| G1g | Prompt Guard: trap payloads refused, normal payloads refused | ≥ ${t.g1g_traps_refused_min}/${sum.g1g.traps}; ≤ ${t.g1g_false_positive_per_10_max}/10 | ${sum.g1g.traps_refused}/${sum.g1g.traps}; ${sum.g1g.false_positives}/${sum.g1g.normal} (${sum.g1g.per_10 === null ? "n/a" : sum.g1g.per_10.toFixed(1)}/10) | ${yes(sum.g1g.pass)} |`,
    `| G1h | SERV cost per decision | recorded | ${usd(sum.g1h.per_decision_usd)} estimated (${sum.g1h.serv_tokens_in.toLocaleString("en")} in, ${sum.g1h.serv_tokens_out.toLocaleString("en")} out tokens over the run) | recorded |`,
    "",
    "## Settings after this run",
    "",
    ...settingLines(r, sum),
    "",
    "## Reader documents",
    "",
    "| Doc | Source | Chars | Est. tokens | JSON | Retry | Time | TTFT | Tokens in / out | Reasoning | Quotes kept / returned |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...r.reads.map(
      (x) =>
        `| ${x.doc_id} | ${x.source === "real" ? x.host : "synthetic"} | ${x.chars.toLocaleString("en")} | ${x.est_tokens.toLocaleString("en")} | ${x.json_ok ? "ok" : (x.error ?? "bad")} | ${x.retried ? "yes" : "no"} | ${s(x.ms)} | ${s(x.ttft_ms)} | ${x.input_tokens ?? "n/a"} / ${x.output_tokens ?? "n/a"} | ${x.reasoning_tokens ?? `${x.reasoning_deltas} deltas`} | ${x.quotes_kept} / ${x.quotes_returned} |`,
    ),
    "",
    r.real_sites.filter((x) => !x.doc).length
      ? `Sites that gave no readable policy page in this run: ${r.real_sites
          .filter((x) => !x.doc)
          .map((x) => `${x.host} (${x.note})`)
          .join(", ")}.`
      : "Every real site gave one readable policy page.",
    "",
    "## Reader output size and reasoning",
    "",
    `- Largest output: ${sum.reasoning.max_output_tokens ?? "n/a"} tokens; replies that reached max_tokens (${r.reader.max_tokens}): ${sum.reasoning.at_cap}.`,
    `- Reasoning tokens reported by the provider: ${sum.reasoning.reasoning_tokens ?? "not reported"}; streamed reasoning chunks seen: ${sum.reasoning.reasoning_deltas}.`,
    `- Any reply from a model other than the one requested: ${r.reads.some((x) => x.fallback_suspected) ? "yes" : "no"}.`,
    "",
    "## Decider payloads",
    "",
    "Kinds: `normal` = G1f with the configured guard mode; `trap` and `guard_normal` = G1g, Prompt Guard declared on every request.",
    "",
    "| Payload | Kind | Guard | Action | Doc | Outcome | Rung | Calls | Verdict | Time | Tokens in / out |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...r.decisions.map(
      (d) =>
        `| ${d.id} | ${d.kind} | ${d.guard ? "on" : "off"} | ${d.action} | ${d.doc_id} | ${d.outcome} | ${d.rung} | ${d.calls} | ${d.verdict ?? "none"} | ${s(d.ms)} | ${d.input_tokens} / ${d.output_tokens} |`,
    ),
    "",
    "## Response shapes",
    "",
    "What a Prompt Guard refusal and an unusable answer looked like in this run (the SERV documentation does not show these fields).",
    "",
    ...shapeLines(r.decisions),
    `- Shadow Agent reported as exhausted on: ${r.decisions.filter((d) => d.shadow_exhausted).map((d) => d.id).join(", ") || "none"}.`,
    "",
    "## Cost",
    "",
    `- Dolphin, from returned usage and listed prices: ${usd(sum.g1h.dolphin_usd)}.`,
    `- SERV, estimated as listed price of the base model times ${r.decider.serv_cost_factor} (guard, shadow and reasoning are billed separately and are not in \`usage\`): ${usd(sum.g1h.serv_usd_estimated)}.`,
    "- The SERV console balance was not read by the script; the factor stays until a console reading replaces it.",
    "",
  ];
  return lines.join("\n");
}
