// Turns a benchmark run into bench/results.json (the shape /bench renders) plus the per-set and
// per-pair rows docs/UKUR.md lists. Every number is counted from the answers here.
import { benchResultsSchema, type BenchResults } from "../api/views.js";
import type { BenchCase, BenchRun, BenchSet } from "./run.js";
import { median, pickShipped, share, type Share, type VariantScore } from "./score.js";
import type { ManualSet } from "./sets.js";
import type { Variant } from "./variants.js";

export interface BenchReport {
  results: BenchResults;
  shipped: string;
  /** Variant id -> set -> share. */
  by_set: Record<string, Record<BenchSet, Share>>;
  /** Variant id -> case id -> final verdict (and the decider's own verdict before the ceilings). */
  rows: Record<string, Record<string, { final: string; serv: string | null; failure: string | null; ceilings: string[] }>>;
  /** Decisions that did not reach a valid answer, per variant. */
  failures: Record<string, number>;
}

const SETS: BenchSet[] = ["A", "B", "spot"];

export function buildReport(run: BenchRun, cases: BenchCase[], variants: Variant[], manual: ManualSet, tie: string, runAt: string): BenchReport {
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const scored = (vid: string, set?: BenchSet) =>
    run.answers
      .filter((a) => a.variant === vid && (!set || byCase.get(a.case_id)!.set === set))
      .map((a) => ({ expected: byCase.get(a.case_id)!.expected, acceptable: byCase.get(a.case_id)!.acceptable, got: a.final }));
  const decided = (vid: string) => run.answers.filter((a) => a.variant === vid && a.calls > 0);
  const scores: (VariantScore & { median_ms: number; model: string })[] = variants.map((v) => {
    const d = decided(v.id);
    const cost = d.reduce((s, a) => s + a.spend.serv_usd + a.spend.dolphin_usd, 0);
    return {
      id: v.id, provider: v.provider, model: v.model, ...share(scored(v.id)),
      cost_usd_per_decision: d.length ? cost / d.length : 0,
      median_ms: median(d.map((a) => a.ms)),
    };
  });
  const shipped = pickShipped(scores, tie);
  const answerOf = (cid: string) => run.answers.find((a) => a.variant === shipped && a.case_id === cid);
  const totalCost =
    run.answers.reduce((s, a) => s + a.spend.serv_usd + a.spend.dolphin_usd, 0) + run.reader_attempts.reduce((s, a) => s + (a.cost_usd ?? 0), 0);
  const setA = cases.filter((c) => c.set === "A").map((c, i) => {
    const pair = manual.pairs[i]!;
    const a = answerOf(c.id);
    return { site: pair.site, action: pair.action, human_verdict: pair.human_verdict, izin_verdict: a?.final ?? null, receipt_id: a?.receipt_id ?? null, note: pair.note };
  });
  const results = benchResultsSchema.parse({
    run_at: runAt,
    total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    set_a: setA,
    set_b: { ...share(scored(shipped, "B")), owner_review: false },
    variants: scores.map((s) => ({
      id: s.id, model: s.model, pairs: s.pairs, agree: s.agree, false_go: s.false_go, false_no_go: s.false_no_go,
      cost_usd_per_decision: Math.round(s.cost_usd_per_decision * 1e6) / 1e6, median_ms: Math.round(s.median_ms), shipped: s.id === shipped,
    })),
  });
  const by_set = Object.fromEntries(variants.map((v) => [v.id, Object.fromEntries(SETS.map((s) => [s, share(scored(v.id, s))]))])) as BenchReport["by_set"];
  const rows = Object.fromEntries(
    variants.map((v) => [
      v.id,
      Object.fromEntries(run.answers.filter((a) => a.variant === v.id).map((a) => [a.case_id, { final: a.final, serv: a.serv_verdict, failure: a.failure, ceilings: a.ceilings }])),
    ]),
  );
  const failures = Object.fromEntries(variants.map((v) => [v.id, decided(v.id).filter((a) => a.failure).length]));
  return { results, shipped, by_set, rows, failures };
}
