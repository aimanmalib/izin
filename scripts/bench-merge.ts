// Joins two benchmark runs on the same frozen evidence into the files docs/UKUR.md and /bench read.
//   bench-merge --base <run dir> --keep V0 --add <run dir> [--out bench]
// <run dir> holds results.json and report.json as written by scripts/bench.ts. Writes
// <out>/results.json and <out>/runs/bench.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { mergeRuns, type RunFiles } from "../server/bench/merge.js";
import { loadBenchConfig } from "../server/bench/variants.js";

const { values } = parseArgs({
  options: { base: { type: "string" }, keep: { type: "string" }, add: { type: "string" }, out: { type: "string", default: "bench" } },
});
if (!values.base || !values.keep || !values.add) {
  console.error("give --base <dir> --keep V0[,V1] --add <dir>");
  process.exit(2);
}
const load = (dir: string): RunFiles => ({
  results: JSON.parse(readFileSync(`${dir}/results.json`, "utf8")) as RunFiles["results"],
  report: JSON.parse(readFileSync(`${dir}/report.json`, "utf8")) as RunFiles["report"],
});
const merged = mergeRuns(load(values.base), values.keep.split(",").map((s) => s.trim()), load(values.add), loadBenchConfig().tie_variant);
mkdirSync(`${values.out}/runs`, { recursive: true });
writeFileSync(`${values.out}/results.json`, `${JSON.stringify(merged.results, null, 2)}\n`);
writeFileSync(`${values.out}/runs/bench.json`, `${JSON.stringify(merged.report, null, 2)}\n`);
console.log(`wrote ${values.out}: shipped ${merged.report.shipped}, variants ${Object.keys(merged.report.runs ?? {}).join(", ")}`);
