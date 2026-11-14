// Reading cost: every token the reader used on Dolphin, what those readings cost, and what the same
// tokens would cost at the listed price of a SERV model. Tokens and cost come from the extractions
// ledger; prices and their public sources come from config. Nothing here is a fixed number.
import type Database from "better-sqlite3";
import type { BenchResults } from "../api/views.js";
import type { IzinConfig } from "../config.js";
import { estimateCost } from "../putus/serv.js";

export interface ReadingCost {
  readings: number;
  tokens_in: number;
  tokens_out: number;
  tokens: number;
  cost_usd: number;
  list: { model: string; input_usd_per_mtok: number; output_usd_per_mtok: number; cost_usd: number };
  price_sources: { serv: string; dolphin: string };
}

interface Row {
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

/**
 * Null until the ledger holds a Dolphin reading. A reading without a stored cost is priced at its model's Dolphin
 * price, or at the highest listed Dolphin price when the model has none, so the cost is never under-counted.
 */
export function readingCost(db: Database.Database, cfg: IzinConfig): ReadingCost | null {
  const rows = db
    .prepare<[], Row>("SELECT model, tokens_in, tokens_out, cost_usd FROM extractions WHERE provider = 'dolphin'")
    .all();
  if (!rows.length) return null;
  const dolphinPrices = cfg.prices_usd_per_mtok.dolphin;
  const highest = {
    input: Math.max(0, ...Object.values(dolphinPrices).map((p) => p.input)),
    output: Math.max(0, ...Object.values(dolphinPrices).map((p) => p.output)),
  };
  const listed = cfg.prices_usd_per_mtok.serv[cfg.reading_cost.compare_model]!;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  for (const r of rows) {
    const i = r.tokens_in ?? 0;
    const o = r.tokens_out ?? 0;
    tokensIn += i;
    tokensOut += o;
    const p = dolphinPrices[r.model] ?? highest;
    cost += r.cost_usd ?? (i * p.input + o * p.output) / 1_000_000;
  }
  return {
    readings: rows.length,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tokens: tokensIn + tokensOut,
    cost_usd: cost,
    list: {
      model: cfg.reading_cost.compare_model,
      input_usd_per_mtok: listed.input,
      output_usd_per_mtok: listed.output,
      cost_usd: (tokensIn * listed.input + tokensOut * listed.output) / 1_000_000,
    },
    price_sources: cfg.reading_cost.price_sources,
  };
}

/** How SERV costs in a saved benchmark run are priced again: which variants ran on SERV, the factor then and now. */
export interface Repricing {
  serv_variants: string[];
  factor_at_run: number;
  factor_now: number;
}

type RunRows = Record<string, Record<string, { serv: string | null; failure: string | null }>>;

export type PricedResults = Omit<BenchResults, "variants"> & {
  total_cost_usd_at_run: number;
  serv_cost_factor: { at_run: number; now: number };
  variants: (BenchResults["variants"][number] & { cost_usd_per_decision_at_run: number })[];
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The variants that ran on SERV, the factor the saved run was priced with, and the factor in config now. */
export function repricingOf(cfg: IzinConfig, bench: { variants: { id: string; provider: string }[]; serv_cost_factor_of_saved_run: number }): Repricing {
  return {
    serv_variants: bench.variants.filter((v) => v.provider === "serv").map((v) => v.id),
    factor_at_run: bench.serv_cost_factor_of_saved_run,
    factor_now: cfg.budget.serv_cost_factor,
  };
}

/**
 * A SERV estimate is listed token price times the factor in config, so the saved run's SERV costs are
 * priced with today's factor by scaling them (the run kept no per-decision tokens, and its files are not
 * rewritten). Dolphin costs carry no factor and stay. The run-time figures are kept beside the new ones.
 * Decisions counted per variant = rows that reached the decider (an answer or a failure).
 */
export function reprice(results: BenchResults, rows: RunRows, p: Repricing): PricedResults {
  const ratio = p.factor_now / p.factor_at_run;
  let servAtRun = 0;
  const variants = results.variants.map((v) => {
    const atRun = v.cost_usd_per_decision;
    if (!p.serv_variants.includes(v.id)) return { ...v, cost_usd_per_decision_at_run: atRun };
    const decided = Object.values(rows[v.id] ?? {}).filter((r) => r.serv !== null || r.failure !== null).length;
    servAtRun += atRun * decided;
    return { ...v, cost_usd_per_decision: round6(atRun * ratio), cost_usd_per_decision_at_run: atRun };
  });
  return {
    ...results,
    variants,
    total_cost_usd: round6(Math.max(0, results.total_cost_usd - servAtRun * (1 - ratio))),
    total_cost_usd_at_run: results.total_cost_usd,
    serv_cost_factor: { at_run: p.factor_at_run, now: p.factor_now },
  };
}

/**
 * A receipt's cost as the receipt page shows it: its reading cost plus its decision tokens priced with the current
 * estimate (listed price times the current SERV factor). The stored receipt keeps the figure it was signed with;
 * this is worked out each time it is shown, so a receipt made under an older factor is not under-counted.
 * Null when the receipt had no decision step with a known price and stored none.
 */
export function receiptCostNow(
  cfg: IzinConfig,
  r: { reader: { cost_usd: number }; decider: { model: string | null; tokens_in: number; tokens_out: number; cost_usd_estimated: number | null } | null },
): number | null {
  const d = r.decider;
  if (!d || !d.model) return null;
  const decider = estimateCost(cfg, d.model, d.tokens_in, d.tokens_out) ?? d.cost_usd_estimated;
  return decider === null ? null : Math.round((r.reader.cost_usd + decider) * 1e6) / 1e6;
}
