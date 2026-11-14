// Regenerates the measured sections of docs/UKUR.md from data, never edited manually. Reads the gallery view
// either from a database file (opened read-only) or from a saved /api/gallery response.
//   npm run ukur -- --db data/izin.db              write the sections into docs/UKUR.md
//   npm run ukur -- --gallery-json gallery.json    same, from a saved /api/gallery response
//                    [--bench-json bench.json]     and the reading cost from a saved /api/bench response
//   add --kering to print the sections and write nothing
// The benchmark, gallery-run, H1 and reader sections are added when their run files exist:
// bench/results.json, bench/runs/bench.json, bench/runs/gallery.json, bench/runs/h1.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { benchResultsSchema, galleryView } from "../server/api/views.js";
import { readingCost, type ReadingCost } from "../server/belanja/kos.js";
import { BENCH_DIR, loadConfig } from "../server/config.js";
import { loadSets } from "../server/bench/sets.js";
import { benchSection, galleryRunSection, readerSection, type BenchReportFile, type GalleryDecided, type GalleryRunFile, type H1File } from "../server/bench/ukur.js";
import { baselineSection, readingCostSection, replaceSection, type GallerySlice } from "../server/galeri/ukur.js";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    "gallery-json": { type: "string" },
    "bench-json": { type: "string" },
    out: { type: "string", default: "docs/UKUR.md" },
    kering: { type: "boolean", default: false },
  },
});

const cfg = loadConfig();
let gallery: GallerySlice;
let cost: ReadingCost | null = null;
if (values.db) {
  const db = new Database(values.db, { readonly: true, fileMustExist: true });
  gallery = galleryView(db, cfg.baseline.restricting_stances);
  cost = readingCost(db, cfg);
  db.close();
} else if (values["gallery-json"]) {
  gallery = JSON.parse(readFileSync(values["gallery-json"], "utf8")) as GallerySlice;
  if (values["bench-json"]) cost = (JSON.parse(readFileSync(values["bench-json"], "utf8")) as { reading_cost: ReadingCost | null }).reading_cost;
} else {
  console.error("give --db <file> or --gallery-json <file>");
  process.exit(2);
}

/** Of the gallery run's receipts, how many got a valid decision (no S8 ceiling): read from the stored receipts. */
function galleryDecided(file: string, run: GalleryRunFile): GalleryDecided {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const get = db.prepare("SELECT receipt_json FROM checks WHERE id = ?");
  const ids = run.checks.map((c) => c.receipt_id).filter((id): id is string => !!id);
  const rows = ids.map((id) => get.get(id) as { receipt_json: string | null } | undefined).filter((r) => r?.receipt_json);
  const serv_answered = rows.filter((r) => !(JSON.parse(r!.receipt_json!) as { decided_by: { ceilings: string[] } }).decided_by.ceilings.includes("S8")).length;
  db.close();
  return { with_receipt: rows.length, serv_answered };
}

const at = new Date().toISOString().slice(0, 10);
const sections: [string, string][] = [
  ["robots-only-baseline", baselineSection(gallery, cfg.public_origin, at)],
  ["reading-cost", readingCostSection(cost, at)],
];
const runFile = <T>(name: string): T | null => (existsSync(`${BENCH_DIR}${name}`) ? (JSON.parse(readFileSync(`${BENCH_DIR}${name}`, "utf8")) as T) : null);
const report = runFile<BenchReportFile>("runs/bench.json");
const results = runFile<unknown>("results.json");
const galleryRun = runFile<GalleryRunFile>("runs/gallery.json");
const h1 = runFile<H1File>("runs/h1.json");
if (report && results) sections.push(["benchmark", benchSection(benchResultsSchema.parse(results), report, loadSets().manual, cfg.public_origin)]);
if (galleryRun) sections.push(["gallery-run", galleryRunSection(galleryRun, h1, values.db ? galleryDecided(values.db, galleryRun) : null)]);
const readerRuns = [
  ...(galleryRun ? [{ name: "Gallery", reader: galleryRun.reader }] : []),
  ...(report ? [{ name: "Benchmark", reader: report.reader }] : []),
  ...(h1 ? [{ name: "H1", reader: h1.reader }] : []),
];
if (readerRuns.length) sections.push(["reader", readerSection(readerRuns, new Date().toISOString())]);
if (values.kering) {
  console.log(sections.map(([, s]) => s).join("\n\n"));
} else {
  let doc = existsSync(values.out) ? readFileSync(values.out, "utf8") : "# What we measured\n";
  for (const [name, s] of sections) doc = replaceSection(doc, name, s);
  writeFileSync(values.out, doc);
  console.log(`wrote ${values.out}`);
}
