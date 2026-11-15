// Reads stored policy documents again on Dolphin with the same model and prompt, and compares the
// quotes with the stored reading. No site is fetched and no decision is made.
//   reread --db <database file> [--n 20] [--out bench/runs/reread.json]
// Needs DOLPHIN_API_KEY. The documents are the newest ones that have a stored Dolphin reading.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { MemoryReaderCache, cacheKey, type CachedReading } from "../server/baca/cache.js";
import { loadPrompt } from "../server/baca/prompt.js";
import { readDoc, readerCall } from "../server/baca/reader.js";
import { compareReadings, summarise, type RereadRow } from "../server/baca/reread.js";
import { loadConfig } from "../server/config.js";
import type { PolicyDoc } from "../server/kumpul/types.js";

const { values } = parseArgs({ options: { db: { type: "string" }, n: { type: "string", default: "20" }, out: { type: "string", default: "bench/runs/reread.json" } } });
if (!values.db) throw new Error("--db <database file> is required");
const cfg = loadConfig();
const db = new Database(values.db, { readonly: true });
const prompt = loadPrompt(cfg.reader.prompt);
const p = cfg.reader.primary;
const docs = db
  .prepare<[], { url: string; kind: string; text: string }>("SELECT url, kind, text FROM docs WHERE kind = 'policy' AND status = 'ok' ORDER BY fetched_at DESC")
  .all();
const getCached = db.prepare<[string], { value: string }>("SELECT value FROM reader_cache WHERE key = ?");

const rows: RereadRow[] = [];
let costUsd = 0;
const seen = new Set<string>();
for (const d of docs) {
  if (rows.length >= Number(values.n)) break;
  const key = cacheKey(d.text, p.provider, p.model, prompt.name);
  if (seen.has(key)) continue;
  seen.add(key);
  const hit = getCached.get(key);
  if (!hit) continue;
  const stored = (JSON.parse(hit.value) as CachedReading).output;
  const doc = { url: d.url, kind: "policy", text: d.text, to_model: true } as unknown as PolicyDoc;
  const fresh = await readDoc({ cfg, prompt, call: readerCall(cfg, process.env), cache: new MemoryReaderCache(), alert: async () => true }, doc, "d1");
  costUsd += fresh.cost_usd;
  if (fresh.status !== "read" || !fresh.output || !fresh.reader?.startsWith(`${p.provider}:`)) {
    console.log(`skipped ${d.url}: ${fresh.status} ${fresh.fail_reasons.join(",")}`);
    continue;
  }
  const row = compareReadings(d.url, d.text.length, stored, fresh.output);
  rows.push(row);
  console.log(`${row.identical ? "same" : "diff"} ${row.same_quotes}/${row.stored_clauses} (fresh ${row.fresh_clauses}) ${d.url}`);
}
const result = { run_at: new Date().toISOString(), reader: `${p.provider}:${p.model}`, prompt: prompt.name, cost_usd: Number(costUsd.toFixed(6)), summary: summarise(rows), rows };
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify(result.summary), "cost USD", result.cost_usd);
