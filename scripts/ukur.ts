// Regenerates the measured sections of docs/UKUR.md from data, never by hand. Reads the gallery view
// either from a database file (opened read-only) or from a saved /api/gallery response.
//   npm run ukur -- --db data/izin.db              write the sections into docs/UKUR.md
//   npm run ukur -- --gallery-json gallery.json    same, from a saved /api/gallery response
//                    [--bench-json bench.json]     and the reading cost from a saved /api/bench response
//   add --kering to print the sections and write nothing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { galleryView } from "../server/api/views.js";
import { readingCost, type ReadingCost } from "../server/belanja/kos.js";
import { loadConfig } from "../server/config.js";
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

const at = new Date().toISOString().slice(0, 10);
const sections: [string, string][] = [
  ["robots-only-baseline", baselineSection(gallery, cfg.public_origin, at)],
  ["reading-cost", readingCostSection(cost, at)],
];
if (values.kering) {
  console.log(sections.map(([, s]) => s).join("\n\n"));
} else {
  let doc = existsSync(values.out) ? readFileSync(values.out, "utf8") : "# What we measured\n";
  for (const [name, s] of sections) doc = replaceSection(doc, name, s);
  writeFileSync(values.out, doc);
  console.log(`wrote ${values.out}`);
}
