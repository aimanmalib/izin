// Per-check state: request budget, per-host spacing, ledger, and robots.txt per origin so every
// fetch Izin makes obeys the rules of the host it goes to.
import type { IzinConfig } from "../config.js";
import { decodeBody, fetchGuarded, type FetchResult } from "./fetch.js";
import { hostListed } from "./discover.js";
import { parseRobots, type ParsedRobots } from "./robots.js";
import type { NetPolicy } from "./ssrf.js";
import type { FetchKind, LedgerEntry, LedgerState } from "./types.js";

export const FETCHER_TOKEN = "IzinBot";

export interface RobotsLoad {
  url: string;
  state: "ok" | "none" | LedgerState;
  parsed: ParsedRobots | null;
}

export class Session {
  used = 0;
  readonly ledger: LedgerEntry[] = [];
  private readonly lastAt = new Map<string, number>();
  private readonly robots = new Map<string, RobotsLoad>();

  constructor(
    readonly cfg: IzinConfig,
    private readonly policy: NetPolicy,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  left(): number {
    return this.cfg.limits.requests_per_check - this.used;
  }

  refused(host: string): boolean {
    return hostListed(host, this.cfg.do_not_fetch_hosts);
  }

  note(url: string, kind: FetchKind, state: LedgerState, note?: string): LedgerEntry {
    const entry: LedgerEntry = {
      url,
      final_url: url,
      kind,
      status: 0,
      bytes: 0,
      sha256: null,
      at: new Date().toISOString(),
      state,
      ...(note ? { note } : {}),
    };
    this.ledger.push(entry);
    return entry;
  }

  private async space(host: string): Promise<void> {
    const robots = [...this.robots.entries()].find(([origin]) => new URL(origin).hostname === host)?.[1].parsed;
    const delayS = robots?.crawlDelay(FETCHER_TOKEN) ?? 0;
    const gap = Math.max(this.cfg.limits.host_interval_ms, Math.min(delayS * 1000, this.cfg.limits.crawl_delay_max_ms));
    const last = this.lastAt.get(host);
    if (last !== undefined) {
      const wait = last + gap - Date.now();
      if (wait > 0) await this.sleep(wait);
    }
  }

  /** One budgeted request. Returns null (and records not_fetched) when the budget is spent. */
  async get(url: string, kind: FetchKind): Promise<{ res: FetchResult; entry: LedgerEntry } | null> {
    if (this.left() <= 0) {
      this.note(url, kind, "not_fetched", "request budget");
      return null;
    }
    const host = new URL(url).hostname;
    await this.space(host);
    this.used++;
    const res = await fetchGuarded(url, { cfg: this.cfg, policy: this.policy, refuseHost: (h) => this.refused(h) });
    this.lastAt.set(host, Date.now());
    const entry: LedgerEntry = {
      url: res.url,
      final_url: res.final_url,
      kind,
      status: res.status,
      bytes: res.bytes,
      sha256: res.sha256,
      at: res.at,
      state: res.state,
      ...(res.note ? { note: res.note } : {}),
    };
    this.ledger.push(entry);
    return { res, entry };
  }

  /** robots.txt for an origin, fetched at most once per check. 404 means no rules. */
  async robotsFor(origin: string): Promise<RobotsLoad> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const url = `${origin}/robots.txt`;
    const got = await this.get(url, "robots");
    let load: RobotsLoad;
    if (!got) load = { url, state: "not_fetched", parsed: null };
    else if (got.res.state === "not_found") load = { url, state: "none", parsed: parseRobots(url, "", this.cfg) };
    else if (got.res.state === "ok") {
      load = { url, state: "ok", parsed: parseRobots(url, decodeBody(got.res.body, got.res.content_type), this.cfg) };
    } else load = { url, state: got.res.state, parsed: null };
    this.robots.set(origin, load);
    return load;
  }

  /**
   * Fetches a page only when that host's robots.txt allows IzinBot. An unreadable robots.txt is
   * treated as "do not fetch" (RFC 9309 asks crawlers to assume a full disallow).
   */
  async page(url: string, kind: FetchKind): Promise<{ res: FetchResult; entry: LedgerEntry } | { entry: LedgerEntry }> {
    const u = new URL(url);
    if (this.refused(u.hostname)) return { entry: this.note(url, kind, "refused", "do-not-fetch host") };
    const robots = await this.robotsFor(u.origin);
    if (!robots.parsed) return { entry: this.note(url, kind, "robots_disallow", `robots.txt ${robots.state}`) };
    if (robots.parsed.isDisallowed(url, FETCHER_TOKEN)) return { entry: this.note(url, kind, "robots_disallow") };
    const got = await this.get(url, kind);
    return got ?? { entry: this.ledger[this.ledger.length - 1] as LedgerEntry };
  }
}
