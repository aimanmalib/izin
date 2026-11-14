// Pre-computed checks for the one-click examples and a short list of named sites (PRD 4.11 timing):
// a receipt saved in the last `cached_receipt_days` for the same site and action is reused, as the
// API does when new checks are paused; otherwise one live check runs and its receipt is saved.
import type { Action, IzinConfig } from "../config.js";
import { registrableDomain } from "../kumpul/discover.js";
import { decideAndFinish, prepareCheck, type PipelineDeps } from "../pipeline.js";
import type { CheckJobs } from "../resit/jobs.js";
import type { ExamplesFile } from "./site.js";

const DAY_MS = 86_400_000;

export interface PrimeEntry {
  key: string | null;
  url: string;
  site: string;
  action: Action;
}

export interface PrimeRow extends PrimeEntry {
  receipt_id: string | null;
  verdict: string | null;
  reused: boolean;
  ms: number;
  error: string | null;
}

/** Examples first, then the named sites; one entry per site and action. */
export function primePlan(cfg: IzinConfig, file: ExamplesFile): PrimeEntry[] {
  const out: PrimeEntry[] = [];
  const seen = new Set<string>();
  const add = (key: string | null, url: string, action: Action) => {
    const site = registrableDomain(new URL(url).hostname, cfg);
    if (seen.has(`${site} ${action}`)) return;
    seen.add(`${site} ${action}`);
    out.push({ key, url, site, action });
  };
  for (const e of file.examples) add(e.key, e.site, e.action);
  for (const p of file.prime) add(null, p.site, p.action);
  return out;
}

/** Entries without a recent saved receipt: the ones a run would pay for. */
export function primeToRun(cfg: IzinConfig, jobs: CheckJobs, plan: PrimeEntry[], now: Date): PrimeEntry[] {
  const since = new Date(now.getTime() - cfg.limits.cached_receipt_days * DAY_MS);
  return plan.filter((e) => !jobs.findRecentDone(e.site, e.action, since));
}

export async function runPrime(
  plan: PrimeEntry[],
  deps: { cfg: IzinConfig; jobs: CheckJobs; pipeline: PipelineDeps; stop: () => Promise<boolean>; now?: () => Date; log?: (line: string) => void },
): Promise<PrimeRow[]> {
  const now = deps.now ?? (() => new Date());
  const rows: PrimeRow[] = [];
  for (const e of plan) {
    const t0 = Date.now();
    const since = new Date(now().getTime() - deps.cfg.limits.cached_receipt_days * DAY_MS);
    const recent = deps.jobs.findRecentDone(e.site, e.action, since);
    let row: PrimeRow;
    if (recent) {
      const verdict = deps.pipeline.store?.getReceipt(recent.id)?.verdict ?? null;
      row = { ...e, receipt_id: recent.id, verdict, reused: true, ms: 0, error: null };
    } else if (await deps.stop()) {
      row = { ...e, receipt_id: null, verdict: null, reused: false, ms: 0, error: "budget cap reached" };
    } else {
      try {
        const r = await decideAndFinish(await prepareCheck({ url: e.url, action: e.action }, deps.pipeline), deps.pipeline);
        row = { ...e, receipt_id: r.id, verdict: r.verdict, reused: false, ms: Date.now() - t0, error: null };
      } catch (err) {
        row = { ...e, receipt_id: null, verdict: null, reused: false, ms: Date.now() - t0, error: err instanceof Error ? err.message.slice(0, 200) : "error" };
      }
    }
    rows.push(row);
    deps.log?.(`${e.site} ${e.action}: ${row.verdict ?? row.error}${row.reused ? " (saved receipt)" : ""}`);
  }
  return rows;
}
