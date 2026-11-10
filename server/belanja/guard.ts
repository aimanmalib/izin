// Spending guard: what each check cost on SERV and on Dolphin goes into the budget table by UTC
// day; new checks stop when a daily or total cap from config is reached. Saved receipts are still
// served (cache-only mode). Build scripts named in config skip the daily caps, never the totals.
import type Database from "better-sqlite3";
import type { IzinConfig } from "../config.js";
import type { DocReading } from "../baca/reader.js";
import type { DeciderResult } from "../putus/serv.js";
import type { CheckSource } from "../resit/store.js";
import type { Alert } from "./alerts.js";

export interface Spend {
  serv_usd: number;
  dolphin_usd: number;
}

type Provider = keyof IzinConfig["prices_usd_per_mtok"];

/** The highest listed price of a provider: used when a model has no listed price, so cost is never under-counted. */
function worstCase(cfg: IzinConfig, provider: Provider, inTok: number, outTok: number): number {
  const prices = Object.values(cfg.prices_usd_per_mtok[provider]);
  const input = Math.max(0, ...prices.map((p) => p.input));
  const output = Math.max(0, ...prices.map((p) => p.output));
  return (inTok * input + outTok * output) / 1_000_000;
}

export function spendOf(cfg: IzinConfig, readings: DocReading[], decider: DeciderResult | null): Spend {
  const spend: Spend = { serv_usd: 0, dolphin_usd: 0 };
  for (const a of readings.flatMap((r) => r.attempts)) {
    const provider = a.provider === "dolphin" ? "dolphin" : "serv";
    const cost = a.cost_usd ?? worstCase(cfg, provider, a.input_tokens ?? 0, a.output_tokens ?? 0);
    spend[`${provider}_usd`] += cost;
  }
  if (decider) {
    spend.serv_usd += decider.cost_usd_estimated ?? worstCase(cfg, "serv", decider.tokens_in, decider.tokens_out) * cfg.budget.serv_cost_factor;
  }
  return spend;
}

export interface BudgetState {
  day: { serv_usd: number; dolphin_usd: number; new_checks: number };
  total: { serv_usd: number; dolphin_usd: number };
}

export class BudgetGuard {
  constructor(
    private readonly db: Database.Database,
    private readonly cfg: IzinConfig,
    private readonly alert: Alert,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private bump(serv: number, dolphin: number, checks: number): void {
    this.db
      .prepare(
        `INSERT INTO budget (day, serv_usd, dolphin_usd, new_checks) VALUES (?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET serv_usd = serv_usd + excluded.serv_usd, dolphin_usd = dolphin_usd + excluded.dolphin_usd,
           new_checks = new_checks + excluded.new_checks`,
      )
      .run(this.today(), serv, dolphin, checks);
  }

  record(spend: Spend): void {
    this.bump(spend.serv_usd, spend.dolphin_usd, 0);
  }

  countNewCheck(): void {
    this.bump(0, 0, 1);
  }

  state(): BudgetState {
    const day = this.db
      .prepare<[string], BudgetState["day"]>("SELECT serv_usd, dolphin_usd, new_checks FROM budget WHERE day = ?")
      .get(this.today()) ?? { serv_usd: 0, dolphin_usd: 0, new_checks: 0 };
    const total = this.db
      .prepare<[], { serv_usd: number | null; dolphin_usd: number | null }>("SELECT SUM(serv_usd) AS serv_usd, SUM(dolphin_usd) AS dolphin_usd FROM budget")
      .get();
    return { day, total: { serv_usd: total?.serv_usd ?? 0, dolphin_usd: total?.dolphin_usd ?? 0 } };
  }

  /** True when a new check from this source must not start; the first such answer of the day alerts the operator. */
  async exhausted(source: CheckSource): Promise<boolean> {
    const b = this.cfg.budget;
    const s = this.state();
    const daily = !b.daily_exempt_sources.includes(source) && (s.day.serv_usd >= b.serv_usd_per_day || s.day.dolphin_usd >= b.dolphin_usd_per_day);
    const total = s.total.serv_usd >= b.serv_usd_total || s.total.dolphin_usd >= b.dolphin_usd_total;
    if (daily || total) await this.alert("budget_cap");
    return daily || total;
  }

  /** Share of the total budget left, the smaller of SERV and Dolphin, as a whole percentage. */
  leftPct(): number {
    const b = this.cfg.budget;
    const t = this.state().total;
    const left = Math.min(1 - t.serv_usd / b.serv_usd_total, 1 - t.dolphin_usd / b.dolphin_usd_total);
    return Math.max(0, Math.round(left * 100));
  }
}
