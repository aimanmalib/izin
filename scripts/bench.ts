// The benchmark run (PRD 4.11): the three pre-registered sets, decided by every variant in
// config/bench.json on the same frozen evidence. Runs where the database is (inside the app
// container on the host: `node dist/bench.js`), or locally with IZIN_FAKE=1.
//   bench [--kering] [--variants V0,V2] [--out-dir data/runs/bench] [--from-evidence bench/evidence]
// --from-evidence decides on the frozen messages of an earlier run: nothing is fetched or read, no receipts.
// Writes <out-dir>/results.json (the /bench shape), <out-dir>/report.json and <out-dir>/evidence/<case>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadConfig } from "../server/config.js";
import { benchCases, runBench, type FrozenEvidence } from "../server/bench/run.js";
import { buildReport } from "../server/bench/results.js";
import { loadSets, syntheticSite } from "../server/bench/sets.js";
import { serveSynthetic } from "../server/bench/sites.js";
import { estimateRun, readerStats } from "../server/bench/stats.js";
import { loadBenchConfig, variantTransport } from "../server/bench/variants.js";
import { defaultPolicy } from "../server/kumpul/ssrf.js";
import { fakeTransport } from "../server/putus/fake.js";
import { bootRuntime, createRuntime } from "../server/runtime.js";

const { values } = parseArgs({
  options: {
    kering: { type: "boolean", default: false },
    variants: { type: "string" },
    "out-dir": { type: "string", default: "data/runs/bench" },
    "from-evidence": { type: "string" },
  },
});

const cfg = loadConfig();
const bench = loadBenchConfig();
const pick = values.variants?.split(",").map((s) => s.trim());
const variants = bench.variants.filter((v) => !pick || pick.includes(v.id));
const sets = loadSets();
const synth = await serveSynthetic(sets.labeled.cases.map((c) => syntheticSite(sets.labeled, c)), defaultPolicy(cfg.limits.fetch_ports));
const cases = benchCases(sets, (host) => synth.url(host));
const evDir = values["from-evidence"];
const frozen = new Map<string, FrozenEvidence>();
if (evDir) {
  for (const c of cases) {
    const f = `${evDir}/${c.id}.json`;
    if (!existsSync(f)) throw new Error(`--from-evidence: ${f} is missing`);
    frozen.set(c.id, JSON.parse(readFileSync(f, "utf8")) as FrozenEvidence);
  }
}
const fetched = evDir ? 0 : cases.filter((c) => c.set !== "B" && !c.input.terms_text).length;
const toDecide = evDir ? [...frozen.values()].filter((e) => !e.skip).length : cases.length;
const est = estimateRun(cfg, bench, {
  reads: evDir ? 0 : fetched + cases.filter((c) => c.set === "B" || c.input.terms_text).length * 0.05,
  serv_decisions: toDecide * variants.filter((v) => v.provider === "serv").length,
  dolphin_decisions: toDecide * variants.filter((v) => v.provider === "dolphin").length,
});

const rt = createRuntime(cfg);
const spent = rt.guard.state().total;
const left = { serv_usd: cfg.budget.serv_usd_total - spent.serv_usd, dolphin_usd: cfg.budget.dolphin_usd_total - spent.dolphin_usd };
console.log(`bench: ${cases.length} cases${evDir ? ` from frozen evidence (${toDecide} to decide)` : ""} (A ${sets.manual.pairs.length}, B ${sets.labeled.cases.length}, spot ${sets.spot.pairs.length}) x ${variants.map((v) => v.id).join(", ")}; upper bound SERV USD ${est.serv_usd}, Dolphin USD ${est.dolphin_usd}; left SERV USD ${left.serv_usd.toFixed(4)}, Dolphin USD ${left.dolphin_usd.toFixed(4)}`);
if (values.kering || est.serv_usd > left.serv_usd || est.dolphin_usd > left.dolphin_usd) {
  if (!values.kering) console.error("the upper bound is more than the budget left: not started");
  await synth.close();
  process.exit(values.kering ? 0 : 1);
}
await bootRuntime(rt, cfg);
const runAt = new Date().toISOString();
const run = await runBench(cases, variants, {
  pipeline: { ...rt.pipeline, policy: synth.policy, store: rt.store, source: "bench" },
  transportFor: (v) => (process.env.IZIN_FAKE === "1" ? fakeTransport() : variantTransport(cfg, v)),
  concurrency: bench.concurrency,
  onSpend: (s) => rt.guard.record(s),
  stop: async () => rt.guard.exhausted("bench"),
  log: console.log,
  frozen,
});
await synth.close();
const report = buildReport(run, cases, variants, sets.manual, bench.tie_variant, runAt);
const dir = values["out-dir"];
mkdirSync(`${dir}/evidence`, { recursive: true });
writeFileSync(`${dir}/results.json`, `${JSON.stringify(report.results, null, 2)}\n`);
writeFileSync(
  `${dir}/report.json`,
  `${JSON.stringify({ run_at: runAt, stopped: run.stopped, shipped: report.shipped, variants: variants, by_set: report.by_set, failures: report.failures, rows: report.rows, reader: readerStats(run.reader_attempts) }, null, 2)}\n`,
);
for (const e of run.evidence) writeFileSync(`${dir}/evidence/${e.id}.json`, `${JSON.stringify(e, null, 2)}\n`);
console.log(`wrote ${dir}: shipped ${report.shipped}${run.stopped ? " (stopped at the budget cap)" : ""}`);
rt.db.close();
