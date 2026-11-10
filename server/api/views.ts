// Read-only views for /api/gallery, /api/bench and the health numbers. They read the tracked
// files (config/gallery.json, bench/*.json) and the database; nothing is hard-coded here.
import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { BENCH_DIR, GALLERY_PATH } from "../config.js";

interface GalleryFile {
  sites: { host: string; group: string }[];
  blocked_reader: { host: string; reason: string }[];
}

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

export function galleryView(db: Database.Database, path: string = GALLERY_PATH) {
  const file = readJson<GalleryFile>(path) ?? { sites: [], blocked_reader: [] };
  const rows = db
    .prepare<[], { site: string; action: string; check_id: string; updated_at: string; changed: number; verdict: string | null }>(
      `SELECT g.site, g.action, g.check_id, g.updated_at, g.changed, c.verdict
       FROM gallery g LEFT JOIN checks c ON c.id = g.check_id AND c.status = 'done'`,
    )
    .all();
  return {
    sites: file.sites.map((s) => ({
      host: s.host,
      group: s.group,
      checks: Object.fromEntries(
        rows
          .filter((r) => r.site === s.host)
          .map((r) => [r.action, { verdict: r.verdict, receipt_id: r.check_id, updated_at: r.updated_at, changed: r.changed === 1 }]),
      ),
    })),
    blocked_reader: file.blocked_reader,
  };
}

interface ReadabilityFile {
  run_at: string;
  user_agent: string;
  counts: Record<string, unknown>;
}

/** Readability counts now; benchmark results join when their file exists. */
export function benchView(dir: string = BENCH_DIR) {
  const readability = readJson<ReadabilityFile>(`${dir}readability.json`);
  return {
    readability: readability ? { run_at: readability.run_at, user_agent: readability.user_agent, counts: readability.counts } : null,
    results: readJson<unknown>(`${dir}results.json`),
  };
}

/** Share of reader tokens (in + out) that were read on Dolphin, from stored extractions; null before any. */
export function dolphinShare(db: Database.Database): number | null {
  const rows = db
    .prepare<[], { provider: string; t: number }>(
      "SELECT provider, SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) AS t FROM extractions GROUP BY provider",
    )
    .all();
  const all = rows.reduce((s, r) => s + r.t, 0);
  if (!all) return null;
  return Math.round((rows.filter((r) => r.provider === "dolphin").reduce((s, r) => s + r.t, 0) / all) * 1000) / 1000;
}
