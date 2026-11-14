// Readability run: one collector pass per candidate site (robots.txt + home + policy pages),
// IzinBot only, no model calls. Writes bench/readability.json and config/gallery.json.
//   npm run readability -- --kering     list the candidates and what would be skipped, fetch nothing
//   npm run readability                 run, then write both files
//   npm run readability -- --pilih      rebuild config/gallery.json from bench/readability.json, fetch nothing
//   npm run readability -- --hos a,b    read only these candidate hosts again and fold them into both files:
//                                       their bench entries are replaced, the gallery matrix sites stay as they are
// A site that blocks IzinBot is recorded as blocked. Nothing here retries with another identity.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../server/config.js";
import { collect } from "../server/kumpul/collect.js";
import {
  classify, mergeRerun, pickGallery, rebuildBlocked,
  type Candidate, type Gallery, type ReadabilityFile, type ReadabilitySite,
} from "../server/galeri/readability.js";

interface Candidates {
  gallery_size: number;
  concurrency: number;
  sites: Candidate[];
}

const { values } = parseArgs({
  options: {
    kering: { type: "boolean", default: false },
    pilih: { type: "boolean", default: false },
    candidates: { type: "string", default: "config/candidates.json" },
    out: { type: "string", default: "bench/readability.json" },
    gallery: { type: "string", default: "config/gallery.json" },
    hos: { type: "string" },
  },
});

const cfg = loadConfig();
const cand = JSON.parse(readFileSync(values.candidates, "utf8")) as Candidates;
const banned = cfg.do_not_fetch_hosts.map((h) => h.toLowerCase());
const isBanned = (host: string) => banned.some((d) => host === d || host.endsWith(`.${d}`));
const named = values.hos ? values.hos.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) : null;
const unknown = (named ?? []).filter((h) => !cand.sites.some((c) => c.host === h));
if (unknown.length) {
  console.error(`not candidate hosts: ${unknown.join(", ")}`);
  process.exit(2);
}
const allHosts = cand.sites.filter((c) => !isBanned(c.host.toLowerCase()));
const hosts = named ? allHosts.filter((c) => named.includes(c.host)) : allHosts;
const skipped = cand.sites.filter((c) => isBanned(c.host.toLowerCase()));

const galleryComment =
  "Picked by scripts/readability.ts from bench/readability.json: readable sites in candidate order; blocked_reader lists the sites IzinBot could not read, with the reason.";

function writeGallery(results: ReadabilitySite[]): void {
  const gallery = {
    _comment: galleryComment,
    ...pickGallery(hosts, results, cand.gallery_size),
  };
  mkdirSync(dirname(values.gallery), { recursive: true });
  writeFileSync(values.gallery, `${JSON.stringify(gallery, null, 2)}\n`);
  console.log(`gallery ${gallery.sites.length}; blocked_reader ${gallery.blocked_reader.length}`);
}

if (values.pilih) {
  writeGallery((JSON.parse(readFileSync(values.out, "utf8")) as { sites: ReadabilitySite[] }).sites);
  process.exit(0);
}

if (values.kering) {
  console.log(`user agent: ${cfg.user_agent}`);
  console.log(`would check ${hosts.length} sites (${cfg.limits.requests_per_check} requests max each):`);
  for (const c of hosts) console.log(`  ${c.host}${c.group ? `  [${c.group}]` : ""}`);
  if (skipped.length) console.log(`skipped (do_not_fetch_hosts): ${skipped.map((c) => c.host).join(", ")}`);
  process.exit(0);
}

mkdirSync(dirname(values.out), { recursive: true });
const results: ReadabilitySite[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < hosts.length) {
    const c = hosts[next++]!;
    const started = Date.now();
    try {
      const out = await collect({ url: `https://${c.host}/` }, { cfg });
      results.push(classify(c, out));
    } catch (err) {
      results.push({
        host: c.host, ...(c.group ? { group: c.group } : {}), readable: false, reason: "fetch_failed",
        robots_status: "error", robots_http: 0, docs_read: 0, requests: 0, read_urls: [],
      });
      console.error(`${c.host}: ${(err as Error).message}`);
    }
    const r = results[results.length - 1]!;
    console.log(`${r.readable ? "read   " : "unread "} ${c.host.padEnd(22)} ${r.reason.padEnd(16)} ${Date.now() - started} ms`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, cand.concurrency) }, () => worker()));

if (named) {
  const runAt = new Date().toISOString();
  const prev = JSON.parse(readFileSync(values.out, "utf8")) as ReadabilityFile;
  const merged = mergeRerun(prev, results, {
    run_at: runAt,
    hosts: hosts.map((c) => c.host),
    note: "Read again after a page marker that also appears on ordinary pages was removed from the challenge list. Same user agent, one collector pass each, no model.",
  });
  writeFileSync(values.out, `${JSON.stringify(merged, null, 2)}\n`);
  const prevGallery = JSON.parse(readFileSync(values.gallery, "utf8")) as Gallery;
  const gallery = { _comment: galleryComment, ...rebuildBlocked(prevGallery, allHosts, merged.sites) };
  writeFileSync(values.gallery, `${JSON.stringify(gallery, null, 2)}\n`);
  console.log(`readable ${merged.counts.readable} of ${merged.counts.sites}; gallery ${gallery.sites.length} (unchanged); blocked_reader ${gallery.blocked_reader.length}`);
  process.exit(0);
}

const order = new Map(hosts.map((c, i) => [c.host, i]));
results.sort((a, b) => order.get(a.host)! - order.get(b.host)!);
const readable = results.filter((r) => r.readable).length;
const bench = {
  run_at: new Date().toISOString(),
  user_agent: cfg.user_agent,
  note: "One collector pass per site: robots.txt, home page and up to the configured number of policy pages. No model was called. Sites that blocked the reader were not retried.",
  counts: { sites: results.length, readable, unreadable: results.length - readable },
  sites: results,
};
writeFileSync(values.out, `${JSON.stringify(bench, null, 2)}\n`);
console.log(`readable ${readable} of ${results.length}`);
writeGallery(results);
