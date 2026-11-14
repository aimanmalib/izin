// Re-measure of the saved benchmark run with the current code ceilings, with no network and no model:
// every saved final verdict (bench/runs/bench.json) meets the ceilings the current code reads from the
// frozen signals of its pair (bench/evidence/). Saved files are read only; the result is a new file.
//   npm run remeasure              write bench/runs/remeasure.json
//   npm run remeasure -- --kering  print it and write nothing
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BENCH_DIR, type Verdict } from "../server/config.js";
import type { FrozenEvidence } from "../server/bench/run.js";
import { remeasure, type SavedPair } from "../server/bench/score.js";
import type { BenchReportFile } from "../server/bench/ukur.js";
import { signalCeilings } from "../server/putus/siling.js";

const { values } = parseArgs({ options: { kering: { type: "boolean", default: false }, out: { type: "string", default: `${BENCH_DIR}runs/remeasure.json` } } });

const report = JSON.parse(readFileSync(`${BENCH_DIR}runs/bench.json`, "utf8")) as BenchReportFile;
const evidence = new Map<string, FrozenEvidence>();
for (const f of readdirSync(`${BENCH_DIR}evidence`).filter((n) => n.endsWith(".json"))) {
  const e = JSON.parse(readFileSync(`${BENCH_DIR}evidence/${f}`, "utf8")) as FrozenEvidence;
  evidence.set(e.id, e);
}

const variants: Record<string, ReturnType<typeof remeasure> & { label: string }> = {};
for (const v of report.variants) {
  const rows = report.rows[v.id] ?? {};
  const pairs: SavedPair[] = Object.entries(rows).map(([id, row]) => {
    const e = evidence.get(id);
    if (!e) throw new Error(`no frozen evidence for ${id}`);
    return {
      id,
      set: e.set as SavedPair["set"],
      expected: e.expected as Verdict,
      acceptable: e.also_acceptable as Verdict[],
      final: row.final as Verdict,
      // The run already applied S1 to S8; S9 then only lowered confidence. Capping twice changes nothing.
      extra: signalCeilings(e.action, e.message.signals),
    };
  });
  const r = remeasure(pairs);
  // The saved scores must come back unchanged before any ceiling is added, or the inputs are not the run's.
  for (const set of ["A", "B", "spot"] as const) {
    const saved = report.by_set[v.id]?.[set];
    const again = remeasure(pairs.filter((p) => p.set === set).map((p) => ({ ...p, extra: [] }))).after;
    if (!saved || JSON.stringify(saved) !== JSON.stringify(again)) throw new Error(`${v.id} set ${set}: saved ${JSON.stringify(saved)} but scored ${JSON.stringify(again)}`);
  }
  variants[v.id] = { label: v.label, ...r };
}

const out = {
  run_at: new Date().toISOString(),
  source: { file: "bench/runs/bench.json", run_at: report.run_at, shipped: report.shipped },
  method: "saved final verdicts and frozen signals; ceilings S9 and S10 applied in code; no network, no model call",
  ceilings: ["S9", "S10"],
  variants,
};
const text = `${JSON.stringify(out, null, 2)}\n`;
if (values.kering) console.log(text);
else {
  if (existsSync(values.out)) console.log(`replacing ${values.out}`);
  writeFileSync(values.out, text);
  console.log(`wrote ${values.out}`);
}
for (const [id, v] of Object.entries(variants)) {
  console.log(`${id}: agree ${v.before.agree} -> ${v.after.agree} of ${v.after.pairs}, false GO ${v.before.false_go} -> ${v.after.false_go}, false NO-GO ${v.before.false_no_go} -> ${v.after.false_no_go}; changed ${v.changed.map((c) => `${c.id} ${c.before}->${c.after}`).join(", ") || "none"}`);
}
