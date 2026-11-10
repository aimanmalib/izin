// Check jobs in the checks table: queued and running rows survive a restart as records, and the
// lookups the API needs (24-hour cache, recent receipt for a site, site-wide stop) read from here.
import type Database from "better-sqlite3";
import type { Action } from "../config.js";
import type { CheckRequest } from "../api/input.js";
import type { CheckSource } from "./store.js";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobRow {
  id: string;
  status: JobStatus;
  created_at: string;
}

export class CheckJobs {
  constructor(readonly db: Database.Database) {}

  insertQueued(id: string, req: CheckRequest, source: CheckSource, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO checks (id, created_at, site, url, action, detail, source, status, origin, agent, pasted)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .run(id, at.toISOString(), req.site, req.url, req.action, req.detail, source, req.origin, req.agent, req.terms_text ? 1 : 0);
  }

  setStatus(id: string, status: Exclude<JobStatus, "done">): void {
    // A late success is kept: an error mark never overwrites a stored receipt.
    this.db.prepare("UPDATE checks SET status = ? WHERE id = ? AND status != 'done'").run(status, id);
  }

  get(id: string): JobRow | null {
    return this.db.prepare<[string], JobRow>("SELECT id, status, created_at FROM checks WHERE id = ?").get(id) ?? null;
  }

  /** Rows left queued or running by a stopped process are marked as errors on boot. */
  recoverOrphans(): number {
    return this.db.prepare("UPDATE checks SET status = 'error' WHERE status IN ('queued', 'running')").run().changes;
  }

  /** Same origin and action, no detail, agent or pasted terms, newer than `since`; pending rows count. */
  findCached(origin: string, action: Action, since: Date): JobRow | null {
    return (
      this.db
        .prepare<[string, string, string], JobRow>(
          `SELECT id, status, created_at FROM checks
           WHERE origin = ? AND action = ? AND detail IS NULL AND agent IS NULL AND pasted = 0
             AND status IN ('queued', 'running', 'done') AND created_at >= ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(origin, action, since.toISOString()) ?? null
    );
  }

  /** The newest finished receipt for the site and action since `since` (offered when new checks are paused). */
  findRecentDone(site: string, action: Action, since: Date): JobRow | null {
    return (
      this.db
        .prepare<[string, string, string], JobRow>(
          `SELECT id, status, created_at FROM checks WHERE site = ? AND action = ? AND status = 'done' AND created_at >= ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(site, action, since.toISOString()) ?? null
    );
  }

  /** Finished receipts for the site since `since`, newest first, with the JSON for inspection. */
  recentReceipts(site: string, since: Date): { id: string; action: Action; created_at: string; receipt_json: string }[] {
    return this.db
      .prepare<[string, string], { id: string; action: Action; created_at: string; receipt_json: string }>(
        `SELECT id, action, created_at, receipt_json FROM checks WHERE site = ? AND status = 'done' AND created_at >= ?
         ORDER BY created_at DESC`,
      )
      .all(site, since.toISOString());
  }
}
