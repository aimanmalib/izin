// Read-only views for /api/gallery, /api/bench and the health numbers. They read the tracked
// files (config/gallery.json, bench/*.json) and the database; nothing is hard-coded here.
import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { z } from "zod";
import { REMEASURE_FILE, type RemeasureFile } from "../bench/ukur.js";
import { ACTIONS, BENCH_DIR, GALLERY_PATH, type Action, type Stance, type Verdict } from "../config.js";
import { reprice, type ReadingCost, type Repricing } from "../belanja/kos.js";
import { baselineCell, baselineCounts, type BaselineCell, type BaselineCounts, type BaselineReceipt } from "../galeri/baseline.js";

interface GalleryFile {
  sites: { host: string; group: string }[];
  blocked_reader: { host: string; reason: string }[];
}

export interface GalleryCell extends Partial<BaselineCell> {
  verdict: Verdict | null;
  receipt_id: string;
  updated_at: string;
  changed: boolean;
}

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

/** The gallery matrix with the robots-only baseline per finished cell and its counts (ADR 0010). */
export function galleryView(db: Database.Database, restricting: readonly Stance[], path: string = GALLERY_PATH) {
  const file = readJson<GalleryFile>(path) ?? { sites: [], blocked_reader: [] };
  const rows = db
    .prepare<[], { site: string; action: string; check_id: string; updated_at: string; changed: number; verdict: string | null; receipt_json: string | null }>(
      `SELECT g.site, g.action, g.check_id, g.updated_at, g.changed, c.verdict, c.receipt_json
       FROM gallery g LEFT JOIN checks c ON c.id = g.check_id AND c.status = 'done'`,
    )
    .all();
  const cells: BaselineCell[] = [];
  const cell = (r: (typeof rows)[number]): GalleryCell => {
    const out: GalleryCell = { verdict: r.verdict as Verdict | null, receipt_id: r.check_id, updated_at: r.updated_at, changed: r.changed === 1 };
    if (!r.receipt_json) return out;
    const b = baselineCell(JSON.parse(r.receipt_json) as BaselineReceipt, restricting);
    cells.push(b);
    return { ...out, ...b };
  };
  const sites = file.sites.map((s) => ({
    host: s.host,
    group: s.group,
    checks: Object.fromEntries(rows.filter((r) => r.site === s.host).map((r) => [r.action, cell(r)])) as Partial<Record<Action, GalleryCell>>,
  }));
  return { sites, blocked_reader: file.blocked_reader, baseline: baselineCounts(cells) };
}

interface ReadabilityFile {
  run_at: string;
  user_agent: string;
  counts: { sites: number; readable: number; unreadable: number };
}

const verdict = z.enum(["GO", "ASK", "NO_GO"]);
const share = z.object({ pairs: z.number().int().nonnegative(), agree: z.number().int().nonnegative(), false_go: z.number().int().nonnegative(), false_no_go: z.number().int().nonnegative() });

/** Shape of bench/results.json, written by the benchmark run. The /bench page renders exactly this. */
export const benchResultsSchema = z.object({
  run_at: z.string(),
  total_cost_usd: z.number().nonnegative(),
  set_a: z.array(
    z.object({
      site: z.string(),
      action: z.enum(ACTIONS),
      human_verdict: verdict,
      izin_verdict: verdict.nullable(),
      receipt_id: z.string().regex(/^[a-z2-7]{8,32}$/).nullable(),
      note: z.string(),
    }),
  ),
  set_b: share.extend({ owner_review: z.boolean() }),
  variants: z.array(
    share.extend({
      id: z.string().regex(/^V\d$/),
      model: z.string(),
      cost_usd_per_decision: z.number().nonnegative(),
      median_ms: z.number().nonnegative(),
      shipped: z.boolean(),
    }),
  ),
});

export type BenchResults = z.infer<typeof benchResultsSchema>;

/**
 * Readability counts now; benchmark results join when their file exists and has the expected shape.
 * The robots-only baseline comes from the gallery (null until a gallery cell has a receipt).
 * With a repricing, SERV costs of the saved run are shown at the current cost factor (run-time figures kept).
 */
export function benchView(dir: string = BENCH_DIR, baseline: BaselineCounts | null = null, readingCost: ReadingCost | null = null, pricing: Repricing | null = null) {
  const readability = readJson<ReadabilityFile>(`${dir}readability.json`);
  const raw = readJson<unknown>(`${dir}results.json`);
  const parsed = raw === null ? null : benchResultsSchema.safeParse(raw);
  const rows = pricing ? readJson<{ rows: Parameters<typeof reprice>[1] }>(`${dir}runs/bench.json`)?.rows : undefined;
  const results = parsed?.success ? (pricing && rows ? reprice(parsed.data, rows, pricing) : parsed.data) : null;
  const re = readJson<RemeasureFile>(`${dir}${REMEASURE_FILE}`);
  return {
    readability: readability ? { run_at: readability.run_at, user_agent: readability.user_agent, counts: readability.counts } : null,
    results,
    baseline: baseline && baseline.pairs > 0 ? baseline : null,
    reading_cost: readingCost,
    /** The saved run with the current code ceilings applied (scripts/remeasure.ts; no model call). */
    remeasure: re
      ? {
          run_at: re.run_at,
          source_run_at: re.source.run_at,
          shipped: re.source.shipped,
          ceilings: re.ceilings,
          variants: Object.entries(re.variants).map(([id, v]) => ({ id, before: v.before, after: v.after })),
        }
      : null,
  };
}

export type GalleryView = ReturnType<typeof galleryView>;
export type BenchView = ReturnType<typeof benchView>;

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
