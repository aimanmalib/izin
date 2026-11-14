// Joins variants from separate benchmark runs into one report, when a later run decided on the
// frozen evidence of an earlier one (bench --from-evidence). Only the named variants of the earlier
// run are kept (variants that got no valid answer there are dropped, not rescored). The shipped
// variant is picked again with the same K6 rule over the variants kept.
import { benchResultsSchema, type BenchResults } from "../api/views.js";
import { pickShipped } from "./score.js";
import type { BenchReportFile } from "./ukur.js";

export interface RunFiles {
  results: BenchResults;
  report: BenchReportFile;
}

const pickKeys = <T>(o: Record<string, T>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]!]));

export function mergeRuns(base: RunFiles, keep: string[], add: RunFiles, tie: string): RunFiles {
  const addIds = add.results.variants.map((v) => v.id);
  if (keep.some((k) => addIds.includes(k))) throw new Error("a variant is in both runs");
  const missing = keep.filter((k) => !base.results.variants.some((v) => v.id === k));
  if (missing.length) throw new Error(`not in the earlier run: ${missing.join(", ")}`);
  const ids = [...keep, ...addIds];
  const variants = [...base.report.variants.filter((v) => keep.includes(v.id)), ...add.report.variants];
  const rows = [...base.results.variants.filter((v) => keep.includes(v.id)), ...add.results.variants];
  const provider = (id: string) => variants.find((v) => v.id === id)!.provider;
  const shipped = pickShipped(rows.map((r) => ({ ...r, provider: provider(r.id) })), tie);
  const from = addIds.includes(shipped) ? add : base;
  const runs = Object.fromEntries(ids.map((id) => [id, (addIds.includes(id) ? add : base).report.run_at]));
  const results = benchResultsSchema.parse({
    ...from.results,
    run_at: add.results.run_at,
    total_cost_usd: Math.round((base.results.total_cost_usd + add.results.total_cost_usd) * 1e6) / 1e6,
    variants: rows.map((r) => ({ ...r, shipped: r.id === shipped })),
  });
  const report: BenchReportFile = {
    run_at: add.report.run_at,
    stopped: base.report.stopped || add.report.stopped,
    shipped,
    variants,
    by_set: { ...pickKeys(base.report.by_set, keep), ...add.report.by_set },
    failures: { ...pickKeys(base.report.failures, keep), ...add.report.failures },
    rows: { ...pickKeys(base.report.rows, keep), ...add.report.rows },
    // The reader ran once, in the earlier run; a frozen rerun reads nothing.
    reader: base.report.reader,
    runs,
  };
  return { results, report };
}
