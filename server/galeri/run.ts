// The gallery run (PRD 4.11): every site in config/gallery.json against every action, as ordinary
// checks with source "gallery". Sites run in parallel up to a limit; the actions of one site run in
// turn, so the collector's per-host spacing holds. The budget guard is asked before every check.
import { ACTIONS, type Action } from "../config.js";
import type { BudgetGuard } from "../belanja/guard.js";
import type { Attempt } from "../baca/reader.js";
import { decideAndFinish, prepareCheck, type PipelineDeps } from "../pipeline.js";
import type { ReceiptStore } from "../resit/store.js";

export interface GallerySite {
  host: string;
  policy_hints?: string[];
}

export interface GalleryCheck {
  site: string;
  action: Action;
  receipt_id: string | null;
  verdict: string | null;
  ms_total: number;
  changed: boolean;
  error: string | null;
}

export interface GalleryRun {
  checks: GalleryCheck[];
  reader_attempts: Attempt[];
  stopped: boolean;
}

export interface GalleryDeps {
  pipeline: PipelineDeps;
  store: ReceiptStore;
  guard: BudgetGuard;
  concurrency: number;
  actions?: readonly Action[];
  /** Start page of a host (default https://host/). */
  urlFor?: (host: string) => string;
  now?: () => Date;
  log?: (line: string) => void;
}

export async function runGallery(sites: GallerySite[], deps: GalleryDeps): Promise<GalleryRun> {
  const actions = deps.actions ?? ACTIONS;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const urlFor = deps.urlFor ?? ((h: string) => `https://${h}/`);
  const out: GalleryRun = { checks: [], reader_attempts: [], stopped: false };
  const queue = [...sites];
  const pipeline: PipelineDeps = {
    ...deps.pipeline,
    store: deps.store,
    source: "gallery",
    onSpend: (s) => deps.guard.record(s),
  };
  const one = async (site: GallerySite) => {
    for (const action of actions) {
      if (out.stopped || (await deps.guard.exhausted("gallery"))) return void (out.stopped = true);
      const t0 = now().getTime();
      try {
        const p = await prepareCheck({ url: urlFor(site.host), action, ...(site.policy_hints?.length ? { policy_hints: site.policy_hints } : {}) }, pipeline);
        out.reader_attempts.push(...p.readings.filter((x) => !x.cached).flatMap((x) => x.attempts));
        const r = await decideAndFinish(p, pipeline);
        const { changed } = deps.store.saveGallery(site.host, action, r.id, now().toISOString());
        out.checks.push({ site: site.host, action, receipt_id: r.id, verdict: r.verdict, ms_total: r.totals.ms, changed, error: null });
        log(`${site.host} ${action}: ${r.verdict} in ${(r.totals.ms / 1000).toFixed(1)} s`);
      } catch (e) {
        out.checks.push({ site: site.host, action, receipt_id: null, verdict: null, ms_total: now().getTime() - t0, changed: false, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
        log(`${site.host} ${action}: error`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency, queue.length) }, async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) await one(s);
  }));
  return out;
}
