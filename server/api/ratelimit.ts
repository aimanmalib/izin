// New-check rate limit per client address (sliding hour). The global daily limit is counted in
// the budget table so it survives a restart. Cache hits never reach either limit.
export class IpRateLimit {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly perHour: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until this address may start a new check, or 0 when it may now. */
  retryAfter(ip: string, perHour: number = this.perHour): number {
    const t = this.now();
    const recent = (this.seen.get(ip) ?? []).filter((x) => t - x < 3_600_000);
    this.seen.set(ip, recent);
    if (recent.length < perHour) return 0;
    return Math.max(1, Math.ceil((recent[0]! + 3_600_000 - t) / 1000));
  }

  note(ip: string): void {
    const list = this.seen.get(ip) ?? [];
    list.push(this.now());
    this.seen.set(ip, list);
  }
}

/** Seconds until the next UTC midnight, for the daily limit's Retry-After. */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
