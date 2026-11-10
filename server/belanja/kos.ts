// Reading cost: every token the reader used on Dolphin, what those readings cost, and what the same
// tokens would cost at the listed price of a SERV model. Tokens and cost come from the extractions
// ledger; prices and their public sources come from config. Nothing here is a fixed number.
import type Database from "better-sqlite3";
import type { IzinConfig } from "../config.js";

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
