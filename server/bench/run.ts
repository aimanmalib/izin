// The benchmark run (PRD 4.11): each pre-registered pair is collected and read once with the
// shipped reader, its decider message is frozen as evidence, and every variant decides on that same
// message. The code ceilings are applied to each answer, so the verdict scored is the one a user
// would see. Receipts are stored for Set A pairs so the /bench page can link them. A later run can
// decide on the frozen evidence alone (no site is fetched a second time).
import type { Action, Verdict } from "../config.js";
import type { Spend } from "../belanja/guard.js";
import type { Attempt } from "../baca/reader.js";
import { finishCheck, outcomeOf, prepareCheck, type CheckInput, type Decidable, type PipelineDeps, type PreparedCheck } from "../pipeline.js";
import { decide, LadderMemory, type DeciderResult, type DeciderTransport } from "../putus/serv.js";
import { variantConfig, variantSpend, type Variant } from "./variants.js";
import type { ManualSet, LabeledSet, SpotSet } from "./sets.js";

export type BenchSet = "A" | "B" | "spot";

export interface BenchCase {
  id: string;
  set: BenchSet;
  site: string;
  action: Action;
  input: CheckInput;
  expected: Verdict;
  acceptable: Verdict[];
}

/** The three sets as runnable cases. Set B sites are served locally; `synthUrl` gives their address. */
export function benchCases(sets: { manual: ManualSet; labeled: LabeledSet; spot: SpotSet }, synthUrl: (host: string) => string): BenchCase[] {
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  const a = sets.manual.pairs.map((p, i): BenchCase => {
    const input: CheckInput = { url: p.url, action: p.action };
    if (p.mode === "fetch_once" && p.policy_hints.length) input.policy_hints = p.policy_hints;
    if (p.mode === "paste_recorded" && p.quote) input.terms_text = p.quote;
    return { id: `A${pad(i)}`, set: "A", site: p.site, action: p.action, input, expected: p.human_verdict, acceptable: [] };
  });
  const b = sets.labeled.cases.map((c): BenchCase => {
    const host = `${c.id.toLowerCase()}.example`;
    const input: CheckInput = { url: synthUrl(host), action: c.action };
    if (c.detail) input.detail = c.detail;
    return { id: c.id, set: "B", site: host, action: c.action, input, expected: c.expected, acceptable: c.also_acceptable };
  });
  const s = sets.spot.pairs.map((p, i): BenchCase => ({ id: `S${pad(i)}`, set: "spot", site: p.site, action: p.action, input: { url: p.url, action: p.action }, expected: p.label, acceptable: [] }));
  return [...a, ...b, ...s];
}

/** The frozen evidence of one case: exactly what every variant was given. No full policy text. */
export function evidenceOf(c: BenchCase, p: PreparedCheck) {
  return {
    id: c.id,
    set: c.set,
    site: c.site,
    action: c.action,
    expected: c.expected,
    also_acceptable: c.acceptable,
    mode: p.collected.mode,
    skip: p.skip,
    guard: p.guard,
    blocked: p.collected.signals.blocked.map((b) => ({ url: b.url, status: b.status })),
    message: p.message,
  };
}

export type FrozenEvidence = ReturnType<typeof evidenceOf>;

/** A case rebuilt from its frozen evidence: the same decider message, nothing fetched or read again. */
export function decidableOf(e: FrozenEvidence): Decidable {
  return { input: { action: e.action }, signals: e.message.signals, message: e.message, skip: e.skip, guard: e.guard, collected: { signals: { blocked: e.blocked } } };
}

/** The frozen evidence must be for the same pre-registered case; anything else is refused before a paid call. */
export function checkFrozen(c: BenchCase, e: FrozenEvidence): void {
  if (e.id !== c.id || e.set !== c.set || e.site !== c.site || e.action !== c.action || e.expected !== c.expected) {
    throw new Error(`frozen evidence ${e.id} does not match case ${c.id} (${c.site} ${c.action})`);
  }
}

export interface VariantAnswer {
  case_id: string;
  variant: string;
  serv_verdict: Verdict | null;
  final: Verdict;
  ceilings: string[];
  failure: string | null;
  rung: string | null;
  calls: number;
  ms: number;
  tokens_in: number;
  tokens_out: number;
  spend: Spend;
  receipt_id: string | null;
}

export interface BenchRunDeps {
  pipeline: PipelineDeps;
  transportFor: (v: Variant) => DeciderTransport;
  concurrency: number;
  /** Called with each provider spend as it happens (the budget ledger). */
  onSpend: (s: Spend) => void;
  /** Checked before each paid step; true stops the run (budget reached). */
  stop?: () => Promise<boolean>;
  log?: (line: string) => void;
  /** Frozen evidence by case id: these cases are decided on it without collecting or reading, and keep no receipt. */
  frozen?: Map<string, FrozenEvidence>;
}

export interface BenchRun {
  evidence: ReturnType<typeof evidenceOf>[];
  answers: VariantAnswer[];
  reader_attempts: Attempt[];
  stopped: boolean;
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await f(t);
  }));
}

export async function runBench(cases: BenchCase[], variants: Variant[], deps: BenchRunDeps): Promise<BenchRun> {
  const log = deps.log ?? (() => {});
  const { cfg } = deps.pipeline;
  const out: BenchRun = { evidence: [], answers: [], reader_attempts: [], stopped: false };
  const prepared = new Map<string, Decidable>();
  const live = new Map<string, PreparedCheck>();

  for (const c of cases) {
    const e = deps.frozen?.get(c.id);
    if (!e) continue;
    checkFrozen(c, e);
    prepared.set(c.id, decidableOf(e));
    out.evidence.push(e);
  }

  await pool(cases.filter((c) => !prepared.has(c.id)), deps.concurrency, async (c) => {
    if (out.stopped || (await deps.stop?.())) return void (out.stopped = true);
    const p = await prepareCheck(c.input, deps.pipeline);
    prepared.set(c.id, p);
    live.set(c.id, p);
    const attempts = p.readings.filter((r) => !r.cached).flatMap((r) => r.attempts);
    out.reader_attempts.push(...attempts);
    deps.onSpend({
      serv_usd: attempts.filter((a) => a.provider !== "dolphin").reduce((s, a) => s + (a.cost_usd ?? 0), 0),
      dolphin_usd: attempts.filter((a) => a.provider === "dolphin").reduce((s, a) => s + (a.cost_usd ?? 0), 0),
    });
    out.evidence.push(evidenceOf(c, p));
    log(`read ${c.id} ${c.site} ${c.action}: docs_read ${p.signals.docs_read}, clauses ${p.message.clauses.length}${p.skip ? ", nothing to decide" : ""}`);
  });

  for (const v of variants) {
    const vcfg = variantConfig(cfg, v);
    const deciderDeps = { cfg: vcfg, prompt: deps.pipeline.decider.prompt, transport: deps.transportFor(v), ladder: new LadderMemory() };
    const ready = cases.filter((c) => prepared.has(c.id));
    await pool(ready, deps.concurrency, async (c) => {
      const p = prepared.get(c.id)!;
      if (out.stopped || (!p.skip && (await deps.stop?.()))) return void (out.stopped = true);
      let r: DeciderResult | null = null;
      if (!p.skip) {
        r = await decide(deciderDeps, JSON.stringify(p.message), { guard: v.guard && p.guard });
        if (r.failure === "no_credit") await deps.pipeline.alert("decider_no_credit");
      }
      const spend = variantSpend(cfg, v, r);
      deps.onSpend(spend);
      const outcome = outcomeOf(p, r, deps.pipeline.texts);
      // Set A receipts are kept for every variant read live: each names its own decider model.
      const full = live.get(c.id);
      const receipt_id = c.set === "A" && full ? finishCheck(full, r, deps.pipeline, { saveInputs: v === variants[0] }).id : null;
      out.answers.push({
        case_id: c.id, variant: v.id, serv_verdict: outcome.serv_verdict, final: outcome.final, ceilings: outcome.ceilings,
        failure: r?.failure ?? null, rung: r?.rung ?? null, calls: r?.attempts.length ?? 0, ms: r?.ms ?? 0,
        tokens_in: r?.tokens_in ?? 0, tokens_out: r?.tokens_out ?? 0, spend, receipt_id,
      });
      log(`${v.id} ${c.id}: ${outcome.final} (expected ${c.expected})${r?.failure ? ` failure ${r.failure}` : ""}`);
    });
  }
  return out;
}
