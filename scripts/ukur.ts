// Regenerates the measured sections of docs/UKUR.md from data, never by hand. Reads the gallery view
// either from a database file (opened read-only) or from a saved /api/gallery response.
//   npm run ukur -- --db data/izin.db              write the sections into docs/UKUR.md
//   npm run ukur -- --gallery-json gallery.json    same, from a saved /api/gallery response
//   add --kering to print the sections and write nothing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { galleryView } from "../server/api/views.js";
import { loadConfig } from "../server/config.js";
import { baselineSection, replaceSection, type GallerySlice } from "../server/galeri/ukur.js";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    "gallery-json": { type: "string" },
    out: { type: "string", default: "docs/UKUR.md" },
    kering: { type: "boolean", default: false },
  },
});

const cfg = loadConfig();
let gallery: GallerySlice;
if (values.db) {
  const db = new Database(values.db, { readonly: true, fileMustExist: true });
  gallery = galleryView(db, cfg.baseline.restricting_stances);
  db.close();
} else if (values["gallery-json"]) {
  gallery = JSON.parse(readFileSync(values["gallery-json"], "utf8")) as GallerySlice;
} else {
  console.error("give --db <file> or --gallery-json <file>");
  process.exit(2);
}

const section = baselineSection(gallery, cfg.public_origin, new Date().toISOString().slice(0, 10));
if (values.kering) {
  console.log(section);
} else {
  const doc = existsSync(values.out) ? readFileSync(values.out, "utf8") : "# What we measured\n";
  writeFileSync(values.out, replaceSection(doc, "robots-only-baseline", section));
  console.log(`wrote ${values.out}`);
}
