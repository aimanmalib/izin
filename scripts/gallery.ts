// The gallery run and the H1 live check (PRD 4.11, 2.2). Runs where the database is: on the host
// inside the app container (`node dist/gallery.js`), or locally with IZIN_FAKE=1 for a dry check.
//   gallery [--kering] [--sites a.com,b.com] [--undecided] [--stop-at <ISO time>] [--out data/runs/gallery.json]
//   gallery --h1 [--kering] [--out data/runs/h1.json]    10 live sites, one action each, timed
// --kering prints the plan and the upper-bound cost and makes no request.
// --undecided runs only the cells whose saved receipt has no decision (the decider was unavailable);
// cells with a decision keep their receipt. --stop-at starts no new check after that time;
// --max-spend <usd> starts no new check once this run has spent that much on SERV.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { ACTIONS, GALLERY_PATH, loadConfig } from "../server/config.js";
import { estimateRun, readerStats } from "../server/bench/stats.js";
import { loadBenchConfig } from "../server/bench/variants.js";
import { runGallery, type GallerySite } from "../server/galeri/run.js";
import { prepareCheck, decideAndFinish } from "../server/pipeline.js";
import { bootRuntime, createRuntime } from "../server/runtime.js";

const { values } = parseArgs({
  options: {
    kering: { type: "boolean", default: false },
    h1: { type: "boolean", default: false },
    sites: { type: "string" },
    out: { type: "string" },
    undecided: { type: "boolean", default: false },
    "stop-at": { type: "string" },
    "max-spend": { type: "string" },
  },
});

const cfg = loadConfig();
const bench = loadBenchConfig();
const file = JSON.parse(readFileSync(GALLERY_PATH, "utf8")) as { sites: GallerySite[] };
const pick = values.sites?.split(",").map((s) => s.trim());
let sites = values.h1
  ? bench.h1.hosts.map((host) => file.sites.find((s) => s.host === host) ?? { host })
  : file.sites.filter((s) => !pick || pick.includes(s.host));
const actions = values.h1 ? [bench.h1.action] : ACTIONS;
const stopAt = values["stop-at"] ? Date.parse(values["stop-at"]) : null;
const maxSpend = values["max-spend"] ? Number(values["max-spend"]) : null;
if (maxSpend !== null && !(maxSpend > 0)) throw new Error(`--max-spend is not an amount: ${values["max-spend"]}`);
if (stopAt !== null && Number.isNaN(stopAt)) throw new Error(`--stop-at is not a time: ${values["stop-at"]}`);

const rt = createRuntime(cfg);
const undecided = new Set(values.undecided ? undecidedCells(rt.db) : []);
const skip = values.undecided ? (host: string, action: string) => !undecided.has(`${host} ${action}`) : undefined;
if (skip) sites = sites.filter((s) => actions.some((a) => !skip(s.host, a)));
const cells = skip ? sites.reduce((n, s) => n + actions.filter((a) => !skip(s.host, a)).length, 0) : sites.length * actions.length;
const est = estimateRun(cfg, bench, { reads: sites.length, serv_decisions: cells, dolphin_decisions: 0 });
const spent = rt.guard.state().total;
const left = { serv_usd: cfg.budget.serv_usd_total - spent.serv_usd, dolphin_usd: cfg.budget.dolphin_usd_total - spent.dolphin_usd };
console.log(`${values.h1 ? "H1" : "gallery"}: ${sites.length} sites x ${actions.length} actions, ${cells} cells; upper bound SERV USD ${est.serv_usd}, Dolphin USD ${est.dolphin_usd}; left SERV USD ${left.serv_usd.toFixed(4)}, Dolphin USD ${left.dolphin_usd.toFixed(4)}`);
if (values.kering) {
  console.log(sites.map((s) => s.host).join(", "));
  process.exit(0);
}
if (est.serv_usd > left.serv_usd || est.dolphin_usd > left.dolphin_usd) {
  console.error("the upper bound is more than the budget left: not started");
  process.exit(1);
}
await bootRuntime(rt, cfg);
const runAt = new Date().toISOString();
const before = rt.guard.state().total;
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${path}`);
};
const spendSince = () => {
  const now = rt.guard.state().total;
  return { serv_usd: Math.round((now.serv_usd - before.serv_usd) * 1e6) / 1e6, dolphin_usd: Math.round((now.dolphin_usd - before.dolphin_usd) * 1e6) / 1e6 };
};

if (values.h1) {
  const pipeline = { ...rt.pipeline, store: rt.store, source: "gallery" as const, onSpend: (s: Parameters<typeof rt.guard.record>[0]) => rt.guard.record(s) };
  const rows = [];
  const attempts = [];
  for (const s of sites) {
    const t0 = Date.now();
    try {
      const p = await prepareCheck({ url: `https://${s.host}/`, action: bench.h1.action, ...(s.policy_hints?.length ? { policy_hints: s.policy_hints } : {}) }, pipeline);
      attempts.push(...p.readings.filter((r) => !r.cached).flatMap((r) => r.attempts));
      const r = await decideAndFinish(p, pipeline);
      rows.push({ site: s.host, receipt_id: r.id, verdict: r.verdict, docs_read: r.signals.docs_read, ms: Date.now() - t0, error: null });
    } catch (e) {
      rows.push({ site: s.host, receipt_id: null, verdict: null, docs_read: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    console.log(`${s.host}: ${rows.at(-1)!.verdict ?? "error"} in ${(rows.at(-1)!.ms / 1000).toFixed(1)} s`);
  }
  const pass = rows.every((r) => !r.error && r.receipt_id && r.ms <= bench.h1.max_ms);
  write(values.out ?? "data/runs/h1.json", { run_at: runAt, action: bench.h1.action, max_ms: bench.h1.max_ms, pass, rows, reader: readerStats(attempts), spend: spendSince() });
} else {
  // Same guard, asked two more things: no new check after --stop-at or past --max-spend.
  const over = () => (stopAt !== null && Date.now() >= stopAt) || (maxSpend !== null && spendSince().serv_usd >= maxSpend);
  const guard = stopAt === null && maxSpend === null ? rt.guard : Object.assign(Object.create(rt.guard) as typeof rt.guard, {
    exhausted: async (source: Parameters<typeof rt.guard.exhausted>[0]) => over() || rt.guard.exhausted(source),
  });
  const run = await runGallery(sites, { pipeline: rt.pipeline, store: rt.store, guard, ...(skip ? { skip } : {}), concurrency: bench.gallery_concurrency, log: console.log });
  write(values.out ?? "data/runs/gallery.json", {
    run_at: runAt,
    user_agent: cfg.user_agent,
    sites: sites.length,
    cells,
    stopped: run.stopped,
    checks: run.checks,
    reader: readerStats(run.reader_attempts),
    spend: spendSince(),
  });
}
rt.db.close();

/** Gallery cells whose saved receipt carries no decision (decided_by.flags has decider_unavailable). */
function undecidedCells(db: typeof rt.db): string[] {
  const rows = db.prepare(
    `SELECT g.site, g.action FROM gallery g JOIN checks c ON c.id = g.check_id
      WHERE EXISTS (SELECT 1 FROM json_each(json_extract(c.receipt_json, '$.decided_by.flags')) f WHERE f.value = 'decider_unavailable')`,
  ).all() as { site: string; action: string }[];
  return rows.map((r) => `${r.site} ${r.action}`);
}
