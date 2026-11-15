// The check service behind both the HTTP API and the MCP tools: validate, answer from the cache,
// refuse to re-fetch a site that forbade all automation, apply rate and spending limits, then
// queue a new check. One code path, so web, API and MCP share the same limits.
import type { IzinConfig } from "../config.js";
import type { BudgetGuard } from "../belanja/guard.js";
import { forbiddingSentence } from "../kumpul/stop.js";
import type { NetPolicy } from "../kumpul/ssrf.js";
import { runCheck, type CheckInput, type PipelineDeps } from "../pipeline.js";
import type { CheckJobs, JobStatus } from "../resit/jobs.js";
import { newReceiptId, type Receipt } from "../resit/receipt.js";
import type { CheckSource, ReceiptStore } from "../resit/store.js";
import { assertFetchable, InvalidInput, parseCheckRequest, type CheckRequest, type InputError } from "./input.js";
import { JobQueue } from "./queue.js";
import { IpRateLimit, secondsToUtcMidnight } from "./ratelimit.js";

export type SubmitResult =
  | { kind: "accepted"; id: string; status: JobStatus; cached: boolean; no_refetch?: true }
  | { kind: "invalid"; code: InputError }
  | { kind: "rate_limited"; retry_after_s: number; scope: "ip" | "day" }
  | { kind: "budget_exhausted"; cached_id: string | null };

export interface ServiceDeps {
  cfg: IzinConfig;
  store: ReceiptStore;
  jobs: CheckJobs;
  guard: BudgetGuard;
  /** Pipeline dependencies shared by every check; the store, source, id and spend hook are set per job. */
  pipeline: PipelineDeps;
  policy?: NetPolicy;
  now?: () => Date;
  newId?: () => string;
  run?: (input: CheckInput, deps: PipelineDeps) => Promise<Receipt>;
}

const DAY_MS = 86_400_000;

export class CheckService {
  readonly queue: JobQueue;
  private readonly rate: IpRateLimit;
  private readonly now: () => Date;

  constructor(private readonly d: ServiceDeps) {
    const l = d.cfg.limits;
    this.now = d.now ?? (() => new Date());
    this.queue = new JobQueue(d.jobs, l.queue_concurrency, l.check_timeout_s * 1000);
    this.rate = new IpRateLimit(l.rate_new_checks_per_ip_hour, () => this.now().getTime());
  }

  private ago(ms: number): Date {
    return new Date(this.now().getTime() - ms);
  }

  /** A receipt from the last N days in which the site's robots.txt forbade any automated access. */
  siteWideStop(req: CheckRequest): string | null {
    const since = this.ago(this.d.cfg.limits.no_refetch_blocked_days * DAY_MS);
    const rows = this.d.jobs.recentReceipts(req.site, since);
    const stops = rows.filter((row) => {
      const stop = (JSON.parse(row.receipt_json) as Receipt).signals.robots_stop;
      return stop?.by === "comment" && !!stop.sentence && this.forbidsEveryAction(stop.sentence);
    });
    return (stops.find((r) => r.action === req.action) ?? stops[0])?.id ?? null;
  }

  private forbidsEveryAction(sentence: string): boolean {
    const cfg = this.d.cfg;
    const scoped = { ...cfg, robots_stop: { ...cfg.robots_stop, action_terms: { ...cfg.robots_stop.action_terms, read_page: [] } } };
    return forbiddingSentence(sentence, "read_page", scoped) !== null;
  }

  async submit(body: unknown, source: CheckSource, ip: string): Promise<SubmitResult> {
    const { cfg, jobs, guard } = this.d;
    let req: CheckRequest;
    try {
      req = parseCheckRequest(cfg, body);
    } catch (e) {
      if (e instanceof InvalidInput) return { kind: "invalid", code: e.code };
      throw e;
    }
    if (!req.detail && !req.terms_text && !req.agent) {
      const hit = jobs.findCached(req.origin, req.action, this.ago(cfg.limits.cache_hours * 3_600_000));
      if (hit) return { kind: "accepted", id: hit.id, status: hit.status, cached: true };
    }
    const stopId = this.siteWideStop(req);
    if (stopId) return { kind: "accepted", id: stopId, status: "done", cached: true, no_refetch: true };
    try {
      await assertFetchable(cfg, req, this.d.policy);
    } catch (e) {
      if (e instanceof InvalidInput) return { kind: "invalid", code: e.code };
      throw e;
    }
    const ipWait = this.rate.retryAfter(ip);
    if (ipWait) return { kind: "rate_limited", retry_after_s: ipWait, scope: "ip" };
    if (guard.state().day.new_checks >= cfg.limits.rate_new_checks_per_day) {
      return { kind: "rate_limited", retry_after_s: secondsToUtcMidnight(this.now()), scope: "day" };
    }
    if (await guard.exhausted(source)) {
      const recent = jobs.findRecentDone(req.site, req.action, this.ago(cfg.limits.cached_receipt_days * DAY_MS));
      return { kind: "budget_exhausted", cached_id: recent?.id ?? null };
    }

    const id = this.d.newId?.() ?? newReceiptId(cfg.receipt.id_length);
    jobs.insertQueued(id, req, source, this.now());
    guard.countNewCheck();
    this.rate.note(ip);
    const input: CheckInput = {
      url: req.url,
      action: req.action,
      ...(req.detail ? { detail: req.detail } : {}),
      ...(req.terms_text ? { terms_text: req.terms_text } : {}),
      ...(req.agent ? { agent: req.agent } : {}),
    };
    const deps: PipelineDeps = {
      ...this.d.pipeline,
      ...(this.d.policy ? { policy: this.d.policy } : {}),
      store: this.d.store,
      source,
      newId: () => id,
      onSpend: (s) => guard.record(s),
    };
    const run = this.d.run ?? runCheck;
    this.queue.push({ id, run: () => run(input, deps) });
    return { kind: "accepted", id, status: "queued", cached: false };
  }

  /** Status and, when done, the stored receipt; null for an unknown id. */
  result(id: string): { status: JobStatus; receipt?: Receipt } | null {
    const row = this.d.jobs.get(id);
    if (!row) return null;
    if (row.status !== "done") return { status: row.status };
    const receipt = this.d.store.getReceipt(id);
    return receipt ? { status: "done", receipt } : { status: "error" };
  }

  /** The newest saved receipt for the site and action, read from the store with no fetch and no model call; null when none. */
  savedReceipt(req: CheckRequest): Receipt | null {
    const row = this.d.jobs.findLatestPlain(req.site, req.action);
    return row ? (this.d.store.getReceipt(row.id) ?? null) : null;
  }

  /** New checks are paused (spending cap reached); saved receipts are still served. A status read, so it never alerts. */
  async cacheOnly(): Promise<boolean> {
    return this.d.guard.cap("web").kind !== "none";
  }
}
