// In-process job queue: at most N checks run at once, each limited to the check timeout. A check
// that runs past the timeout is reported as an error but keeps its slot until it really ends, so
// the concurrency limit holds; if it then finishes, its receipt is kept (a late success).
import type { CheckJobs, JobStatus } from "../resit/jobs.js";

export type Job = { id: string; run: () => Promise<unknown> };

export class JobQueue {
  private readonly waiting: Job[] = [];
  private active = 0;
  private readonly listeners = new Map<string, Set<(s: JobStatus) => void>>();

  constructor(
    private readonly jobs: CheckJobs,
    private readonly concurrency: number,
    private readonly timeoutMs: number,
  ) {}

  push(job: Job): void {
    this.waiting.push(job);
    this.pump();
  }

  /** Resolves with the job's final status, or null when `ms` passes first. */
  wait(id: string, ms: number): Promise<JobStatus | null> {
    const now = this.jobs.get(id)?.status;
    if (now === "done" || now === "error") return Promise.resolve(now);
    return new Promise((resolve) => {
      const set = this.listeners.get(id) ?? new Set();
      const done = (s: JobStatus | null) => {
        clearTimeout(timer);
        set.delete(listener);
        resolve(s);
      };
      const listener = (s: JobStatus) => done(s);
      const timer = setTimeout(() => done(null), ms);
      set.add(listener);
      this.listeners.set(id, set);
    });
  }

  /** Resolves when nothing is queued or running (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.active || this.waiting.length) await new Promise((r) => setTimeout(r, 5));
  }

  private emit(id: string): void {
    const s = this.jobs.get(id)?.status;
    if (s !== "done" && s !== "error") return;
    for (const l of this.listeners.get(id) ?? []) l(s);
    this.listeners.delete(id);
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.active++;
      void this.runOne(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async runOne(job: Job): Promise<void> {
    this.jobs.setStatus(job.id, "running");
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), this.timeoutMs)));
    const work = job.run().then(
      () => "ok" as const,
      () => "failed" as const,
    );
    const first = await Promise.race([work, timeout]);
    clearTimeout(timer);
    if (first !== "ok") this.jobs.setStatus(job.id, "error");
    this.emit(job.id);
    if (first === "timeout") {
      await work;
      this.emit(job.id);
    }
  }
}
