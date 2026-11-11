// One process's moving parts: the database, stores, spending guard, check service and the
// numbers /api/health reports. The database path comes from IZIN_DB (in-memory when unset, as in
// unit tests); the container sets it to the file inside its data volume.
import type Database from "better-sqlite3";
import type { IzinConfig } from "./config.js";
import { makeAlert, type Alert } from "./belanja/alerts.js";
import { BudgetGuard } from "./belanja/guard.js";
import { SqliteReaderCache } from "./baca/cache.js";
import { resolveModel } from "./baca/provider.js";
import { CheckService, type ServiceDeps } from "./api/service.js";
import type { NetPolicy } from "./kumpul/ssrf.js";
import type { PipelineDeps } from "./pipeline.js";
import { CheckJobs } from "./resit/jobs.js";
import { openDb, ReceiptStore } from "./resit/store.js";
import { pipelineDeps } from "./wiring.js";

export interface Runtime {
  db: Database.Database;
  store: ReceiptStore;
  jobs: CheckJobs;
  guard: BudgetGuard;
  service: CheckService;
  pipeline: PipelineDeps;
  /** "provider:model" of the primary reader, after the boot-time model check. */
  readerLabel: string;
}

export interface RuntimeOpts {
  env?: NodeJS.ProcessEnv;
  dbPath?: string;
  policy?: NetPolicy;
  alert?: Alert;
  now?: () => Date;
  run?: ServiceDeps["run"];
}

export function createRuntime(cfg: IzinConfig, opts: RuntimeOpts = {}): Runtime {
  const env = opts.env ?? process.env;
  const db = openDb(opts.dbPath ?? env.IZIN_DB ?? ":memory:");
  const store = new ReceiptStore(db);
  const jobs = new CheckJobs(db);
  const alert = opts.alert ?? makeAlert(cfg, { env, db });
  const guard = new BudgetGuard(db, cfg, alert, opts.now);
  const pipeline: PipelineDeps = { ...pipelineDeps(cfg, { env, cache: new SqliteReaderCache(db) }), alert };
  const service = new CheckService({
    cfg, store, jobs, guard, pipeline,
    ...(opts.policy ? { policy: opts.policy } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.run ? { run: opts.run } : {}),
  });
  const p = cfg.reader.primary;
  return { db, store, jobs, guard, service, pipeline, readerLabel: `${p.provider}:${p.model}` };
}

/**
 * Boot steps: orphaned queued/running rows become errors, and the primary reader's model is
 * checked against the provider's list (skipped offline or without a key; a failure keeps config).
 */
export async function bootRuntime(rt: Runtime, cfg: IzinConfig, env: NodeJS.ProcessEnv = process.env): Promise<{ orphans: number }> {
  const orphans = rt.jobs.recoverOrphans();
  const p = cfg.reader.primary;
  if (env.IZIN_FAKE !== "1" && env[p.key_env]) {
    try {
      const { model } = await resolveModel(p, { cfg, env });
      rt.pipeline.reader.primaryModel = model;
      rt.readerLabel = `${p.provider}:${model}`;
    } catch {
      // Keep the configured model; the reader's own fallback handles a provider that is down.
    }
  }
  return { orphans };
}
