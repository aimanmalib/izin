// G1 measurement run (see docs/UKUR-G1.md): Dolphin reads 5 real policy pages and 5 synthetic
// ones; SERV decides 20 normal payloads and the trap payloads with the full decider config.
//   npm run g1 -- --kering     plan and cost estimate, no network
//   npm run g1                 run, write the report, add the spend to the budget ledger
//   IZIN_FAKE=1 npm run g1     offline fakes, synthetic documents only (smoke test)
// Pages are fetched by the collector as IzinBot, once per site. A site that blocks the reader is
// recorded as such; nothing here retries with another identity.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import OpenAI, { APIError } from "openai";
import { LANG_DIR, loadConfig, type Action, type IzinConfig } from "../server/config.js";
import { BudgetGuard } from "../server/belanja/guard.js";
import { loadPrompt } from "../server/baca/prompt.js";
import { parseReaderReply } from "../server/baca/parse.js";
import { ReaderError, type CallResult } from "../server/baca/provider.js";
import { costUsd, readerCall, readerMessages } from "../server/baca/reader.js";
import type { ReaderOutput } from "../server/baca/types.js";
import { collect } from "../server/kumpul/collect.js";
import type { PolicyDoc } from "../server/kumpul/types.js";
import { parseDecision } from "../server/putus/decision.js";
import { fakeTransport } from "../server/putus/fake.js";
import { decide, LadderMemory, servTransport, type DeciderTransport, type RawReply } from "../server/putus/serv.js";
import { openDb, ReceiptStore } from "../server/resit/store.js";
import { guardFor } from "../server/putus/message.js";
import { estimate, loadG1, loadSynthetic, normalPayloads, quoteCounts, trapPayloads, type G1Doc, type Payload } from "./g1/plan.js";
import { renderReport, summarise, type DecisionRow, type G1Result, type ReadRow, type ReplyShape } from "./g1/report.js";

const { values } = parseArgs({
  options: {
    kering: { type: "boolean", default: false },
    db: { type: "string", default: process.env.IZIN_DB ?? "data/izin.db" },
    // Rewrite the report from the saved raw results (no calls, no ledger entry).
    render: { type: "boolean", default: false },
  },
});

const cfg = loadConfig();
const g1 = loadG1();
const syn = loadSynthetic();
const fake = process.env.IZIN_FAKE === "1";
const readerPrompt = loadPrompt(cfg.reader.prompt);
const deciderPrompt = loadPrompt(cfg.decider.prompt);
const labels = (JSON.parse(readFileSync(`${LANG_DIR}en.json`, "utf8")) as { actions: Record<Action, string> }).actions;
const banned = cfg.do_not_fetch_hosts.map((h) => h.toLowerCase());
const isBanned = (host: string) => banned.some((d) => host === d || host.endsWith(`.${d}`));

if (values.render) {
  const saved = JSON.parse(readFileSync(g1.raw_out, "utf8")) as { result: G1Result };
  const r = saved.result;
  r.reader.reasoning_effort ??= cfg.reader.primary.reasoning_effort ?? null;
  r.decider.guard ??= cfg.decider.guard;
  writeFileSync(g1.report_out, renderReport(r, g1, summarise(r, g1)));
  console.log(`wrote ${g1.report_out} from ${g1.raw_out}`);
  process.exit(0);
}

const est = estimate(cfg, g1, syn, { reader: readerPrompt.text.length, decider: deciderPrompt.text.length });
console.log(`plan: ${est.reads} reads (${g1.real_docs} real from ${g1.real_sites.join(", ")}; ${syn.docs.length} synthetic), ${est.decider_payloads} decider payloads`);
console.log(`estimate (upper): Dolphin USD ${est.dolphin_usd.toFixed(4)} (cap ${g1.caps_usd.dolphin}), SERV USD ${est.serv_usd.toFixed(4)} (cap ${g1.caps_usd.serv})`);
const overCap = est.dolphin_usd > g1.caps_usd.dolphin || est.serv_usd > g1.caps_usd.serv;
if (values.kering || overCap) {
  if (overCap) console.error("estimate is over the cap in config/g1.json: not running");
  process.exit(overCap ? 1 : 0);
}

const statusOf = (e: unknown) => (e instanceof APIError && typeof e.status === "number" ? e.status : null);

async function listModels(baseURL: string, keyEnv: string): Promise<{ status: number | null; ids: string[] }> {
  if (fake) return { status: null, ids: [] };
  const apiKey = process.env[keyEnv];
  if (!apiKey) return { status: null, ids: [] };
  try {
    const { data, response } = await new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 20_000 }).models.list().withResponse();
    return { status: response.status, ids: data.data.map((m) => m.id) };
  } catch (e) {
    return { status: statusOf(e), ids: [] };
  }
}

// Documents: one collector pass per real site (largest policy page the model may see), then the synthetic set.
// Collected pages are kept in a git-ignored file so a repeat run does not fetch the sites again.
const realSites: G1Result["real_sites"] = [];
const docs: G1Doc[] = [];
const docsCache = g1.raw_out.replace(/[^/]+$/, "docs.json");
if (!fake && existsSync(docsCache)) {
  const cached = JSON.parse(readFileSync(docsCache, "utf8")) as { real_sites: G1Result["real_sites"]; docs: G1Doc[] };
  realSites.push(...cached.real_sites);
  docs.push(...cached.docs);
  console.log(`using ${docs.length} pages collected earlier (${docsCache})`);
} else if (!fake) {
  for (const host of g1.real_sites) {
    if (docs.length >= g1.real_docs) break;
    if (isBanned(host)) {
      realSites.push({ host, doc: false, note: "do_not_fetch_hosts" });
      continue;
    }
    try {
      const c = await collect({ url: `https://${host}/`, action: "purchase" }, { cfg });
      const pick = c.docs.filter((d) => d.kind === "policy" && d.to_model && d.state !== "needs_browser").sort((a, b) => b.text.length - a.text.length)[0];
      if (pick) docs.push({ id: `real-${docs.length + 1}`, source: "real", url: pick.url, kind: pick.kind, text: pick.text });
      realSites.push({ host, doc: !!pick, note: pick ? "read" : c.signals.blocked.length ? "blocked the reader" : "no policy page" });
    } catch (e) {
      realSites.push({ host, doc: false, note: `fetch failed: ${(e as Error).message.slice(0, 60)}` });
    }
  }
}
if (!fake && !existsSync(docsCache)) {
  mkdirSync(dirname(docsCache), { recursive: true });
  writeFileSync(docsCache, JSON.stringify({ real_sites: realSites, docs }));
}
for (const d of syn.docs) docs.push({ id: d.id, source: "synthetic", url: d.url, kind: "policy", text: d.text });

const [servModels, dolphinModels] = await Promise.all([
  listModels(cfg.decider.base_url, cfg.decider.key_env),
  listModels(cfg.reader.primary.base_url, cfg.reader.primary.key_env),
]);

// Reader: Dolphin only (no fallback), tolerant parser plus one retry, as the product does.
const call = readerCall(cfg);
const primary = cfg.reader.primary;
const reads: ReadRow[] = [];
const readings: { doc: G1Doc; out: ReaderOutput | null }[] = [];
let firstReadStatus: number | null = null;
let dolphinSpent = 0;
const httpOf = (reason: string) => (reason === "no_credit" ? 402 : reason === "rate_limited" ? 429 : reason.startsWith("http_") ? Number(reason.slice(5)) : reason === "server_error" ? 500 : null);

for (const doc of docs) {
  if (dolphinSpent > g1.caps_usd.dolphin) {
    console.error("Dolphin cap reached: remaining documents not read");
    break;
  }
  const policyDoc: PolicyDoc = { kind: doc.kind, url: doc.url, text: doc.text, state: "ok", to_model: true, origin_verified: true };
  const row: ReadRow = {
    doc_id: doc.id, source: doc.source, host: new URL(doc.url).hostname, chars: doc.text.length,
    est_tokens: Math.round(doc.text.length / g1.estimate.chars_per_token), json_ok: false, retried: false, error: null, ms: 0,
    ttft_ms: null, input_tokens: null, output_tokens: null, reasoning_tokens: null, reasoning_deltas: 0, quotes_returned: 0,
    quotes_kept: 0, cost_usd: 0, response_model: null, fallback_suspected: false,
  };
  let out: ReaderOutput | null = null;
  for (const [i, extra] of [undefined, cfg.reader.json_retry_note].entries()) {
    let r: CallResult;
    try {
      r = await call(primary, primary.model, readerMessages(readerPrompt, policyDoc, extra));
      firstReadStatus ??= 200;
    } catch (e) {
      const reason = e instanceof ReaderError ? e.reason : "network";
      firstReadStatus ??= httpOf(reason);
      row.error = reason;
      break;
    }
    row.retried = i > 0;
    row.ms += r.ms;
    row.ttft_ms ??= r.ttft_ms;
    row.input_tokens = (row.input_tokens ?? 0) + (r.usage?.input ?? 0);
    row.output_tokens = Math.max(row.output_tokens ?? 0, r.usage?.output ?? 0);
    if (r.usage?.reasoning != null) row.reasoning_tokens = (row.reasoning_tokens ?? 0) + r.usage.reasoning;
    row.reasoning_deltas += r.reasoning_deltas;
    row.cost_usd += costUsd(cfg, primary.provider, primary.model, r.usage?.input ?? 0, r.usage?.output ?? 0) ?? 0;
    row.response_model = r.response_model;
    row.fallback_suspected ||= r.fallback_suspected;
    out = parseReaderReply(r.content);
    if (out) break;
  }
  if (out) {
    const q = quoteCounts(cfg, doc, out);
    Object.assign(row, { json_ok: true, error: null, quotes_returned: q.returned, quotes_kept: q.kept });
  } else row.error ??= "bad_json";
  dolphinSpent += row.cost_usd;
  reads.push(row);
  readings.push({ doc, out });
  console.log(`read ${doc.id.padEnd(12)} ${row.json_ok ? "ok " : row.error} ${(row.ms / 1000).toFixed(1)} s quotes ${row.quotes_kept}/${row.quotes_returned}`);
}

// Decider: full config (rung a) with the product's ladder; every raw reply kept for the shapes.
const raw: { payload: string; reply: RawReply }[] = [];
const errors: { payload: string; status: number | null; detail: string | null }[] = [];
let current = "";
const base: DeciderTransport = fake ? fakeTransport() : servTransport(cfg);
const transport: DeciderTransport = async (body) => {
  try {
    const r = await base(body);
    raw.push({ payload: current, reply: r });
    return r;
  } catch (e) {
    const err = e as { status?: number | null; detail?: string };
    errors.push({ payload: current, status: err.status ?? null, detail: err.detail ?? null });
    throw e;
  }
};
const ladder = new LadderMemory();
// G1f: the normal payloads with the configured guard mode. G1g: the trap payloads and the first
// ten normal payloads again, each with Prompt Guard declared, to count refusals and false positives.
const normal = normalPayloads(cfg, labels, readings, g1.normal_payloads);
const runs: { p: Payload; kind: DecisionRow["kind"]; guard: boolean }[] = [
  ...normal.map((p) => ({ p, kind: "normal" as const, guard: guardFor(cfg, p.input) })),
  ...trapPayloads(cfg, labels, syn, readings).map((p) => ({ p, kind: "trap" as const, guard: true })),
  ...normal.slice(0, g1.guard_normal_payloads).map((p) => ({ p, kind: "guard_normal" as const, guard: true })),
];
const decisions: DecisionRow[] = [];
let firstDecisionStatus: number | null = null;
let servSpent = 0;

function shapeOf(r: RawReply): ReplyShape {
  const keys = r.extras.split("\n").map((l) => l.split(":")[0]!.trim()).filter(Boolean);
  return { refusal: r.refusal, finish_reason: r.finish_reason, content_head: r.content.slice(0, 200), extra_keys: [...new Set(keys)].sort() };
}

for (const { p, kind, guard } of runs) {
  if (servSpent > g1.caps_usd.serv) {
    console.error("SERV cap reached: remaining payloads not sent");
    break;
  }
  current = `${kind}:${p.id}`;
  const res = await decide({ cfg, prompt: deciderPrompt, transport, ladder }, JSON.stringify(p.input), { guard });
  firstDecisionStatus ??= res.attempts[0]?.status ?? null;
  const bad = raw.filter((x) => x.payload === current).find((x) => parseDecision(x.reply.content, cfg) === null);
  servSpent += res.cost_usd_estimated ?? 0;
  decisions.push({
    id: p.id, kind, guard, action: p.action, doc_id: p.doc_id, outcome: res.decision ? "ok" : (res.failure ?? "failed"),
    first_rung_outcome: res.attempts[0]?.outcome ?? "none", rung: res.rung, calls: res.attempts.length,
    verdict: res.decision?.verdict ?? null, schema_ok: res.decision !== null, guard_tripped: res.failure === "guard_tripped",
    shadow_exhausted: res.shadow_exhausted, ms: res.ms, input_tokens: res.tokens_in, output_tokens: res.tokens_out,
    cost_usd_estimated: res.cost_usd_estimated, shape: bad ? shapeOf(bad.reply) : null,
  });
  console.log(`decide ${current.padEnd(34)} ${(res.decision?.verdict ?? res.failure ?? "").padEnd(14)} rung ${res.rung} calls ${res.attempts.length}`);
}

const result: G1Result = {
  run_at: new Date().toISOString(),
  user_agent: cfg.user_agent,
  reader: { provider: primary.provider, model: primary.model, max_tokens: cfg.reader.max_tokens, reasoning_effort: primary.reasoning_effort ?? null },
  decider: { model: cfg.decider.model, reasoning_effort: cfg.decider.reasoning_effort, serv_cost_factor: cfg.budget.serv_cost_factor, guard: cfg.decider.guard },
  g1a: { serv_models_status: servModels.status, serv_first_call_status: firstDecisionStatus },
  g1b: { dolphin_models_status: dolphinModels.status, models_listed: dolphinModels.ids.length, reader_listed: fake || dolphinModels.ids.includes(primary.model), first_call_status: firstReadStatus },
  real_sites: realSites,
  reads,
  decisions,
};
const sum = summarise(result, g1);

function writeOut(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const ledger = (c: IzinConfig) => {
  mkdirSync(dirname(values.db), { recursive: true });
  const db = openDb(values.db);
  new ReceiptStore(db);
  new BudgetGuard(db, c, async () => false).record({ serv_usd: sum.g1h.serv_usd_estimated, dolphin_usd: sum.g1h.dolphin_usd });
  db.close();
};
writeOut(fake ? g1.raw_out.replace(/\.json$/, ".fake.json") : g1.raw_out, `${JSON.stringify({ result, summary: sum, payloads: runs.map((r) => r.p), raw, errors }, null, 2)}\n`);
if (!fake) {
  writeOut(g1.report_out, renderReport(result, g1, sum));
  ledger(cfg);
}
console.log(JSON.stringify({ g1a: sum.g1a, g1b: sum.g1b, g1c: sum.g1c, g1d: sum.g1d, g1e: sum.g1e, g1f: sum.g1f, g1g: sum.g1g, g1h: sum.g1h }, null, 1));
