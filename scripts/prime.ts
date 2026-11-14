// Saves receipts ahead of time for the one-click examples and the named sites in
// config/examples.json, so the first click opens a saved receipt. Runs where the database is: on
// the host inside the app container (`node dist/prime.js`), or locally with IZIN_FAKE=1.
//   prime [--kering] [--out data/runs/prime.json]
// --kering prints the plan, which entries already have a saved receipt, and the upper-bound cost.
// Source "cli": the daily caps do not apply, the total caps do.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../server/config.js";
import { estimateRun } from "../server/bench/stats.js";
import { loadBenchConfig } from "../server/bench/variants.js";
import { bootRuntime, createRuntime } from "../server/runtime.js";
import { primePlan, primeToRun, runPrime } from "../server/web/prime.js";
import { loadExamplesFile } from "../server/web/site.js";

const { values } = parseArgs({
  options: { kering: { type: "boolean", default: false }, out: { type: "string" } },
});

const cfg = loadConfig();
const rt = createRuntime(cfg);
const plan = primePlan(cfg, loadExamplesFile());
const toRun = primeToRun(cfg, rt.jobs, plan, new Date());
const est = estimateRun(cfg, loadBenchConfig(), { reads: toRun.length, serv_decisions: toRun.length, dolphin_decisions: 0 });
const spent = rt.guard.state().total;
const left = { serv_usd: cfg.budget.serv_usd_total - spent.serv_usd, dolphin_usd: cfg.budget.dolphin_usd_total - spent.dolphin_usd };
console.log(`prime: ${plan.length} entries, ${toRun.length} without a saved receipt; upper bound SERV USD ${est.serv_usd}, Dolphin USD ${est.dolphin_usd}; left SERV USD ${left.serv_usd.toFixed(4)}, Dolphin USD ${left.dolphin_usd.toFixed(4)}`);
for (const e of plan) console.log(`  ${e.site} ${e.action}${toRun.includes(e) ? "" : " (saved receipt)"}`);
if (values.kering) process.exit(0);
if (est.serv_usd > left.serv_usd || est.dolphin_usd > left.dolphin_usd) {
  console.error("the upper bound is more than the budget left: not started");
  process.exit(1);
}
await bootRuntime(rt, cfg);
const pipeline = { ...rt.pipeline, store: rt.store, source: "cli" as const, onSpend: (s: Parameters<typeof rt.guard.record>[0]) => rt.guard.record(s) };
const rows = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline, stop: () => rt.guard.exhausted("cli"), log: console.log });
const out = values.out ?? "data/runs/prime.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ run_at: new Date().toISOString(), rows }, null, 2)}\n`);
console.log(`wrote ${out}`);
rt.db.close();
