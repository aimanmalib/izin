// Reader numbers for a run (PRD 2.2 H10 and docs/UKUR.md): token share served by Dolphin, and
// Dolphin's latency, time to first token and output speed. Counted from the attempts the run made.
import type { Attempt } from "../baca/reader.js";
import type { IzinConfig } from "../config.js";
import { median } from "./score.js";
import type { BenchConfig } from "./variants.js";

export interface ReaderStats {
  calls: number;
  ok_calls: number;
  tokens: { dolphin: number; other: number };
  dolphin_share: number | null;
  dolphin: { ok_calls: number; median_ms: number; median_ttft_ms: number | null; median_tokens_per_s: number | null };
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function readerStats(attempts: readonly Attempt[]): ReaderStats {
  const tok = (a: Attempt) => (a.input_tokens ?? 0) + (a.output_tokens ?? 0);
  const ok = attempts.filter((a) => a.outcome === "ok");
  const dolphin = ok.filter((a) => a.provider === "dolphin");
  const d = dolphin.reduce((s, a) => s + tok(a), 0);
  const o = ok.filter((a) => a.provider !== "dolphin").reduce((s, a) => s + tok(a), 0);
  const ttft = dolphin.filter((a) => a.ttft_ms !== null).map((a) => a.ttft_ms!);
  const speed = dolphin
    .filter((a) => a.output_tokens && a.ttft_ms !== null && a.ms > a.ttft_ms)
    .map((a) => a.output_tokens! / ((a.ms - a.ttft_ms!) / 1000));
  return {
    calls: attempts.length,
    ok_calls: ok.length,
    tokens: { dolphin: d, other: o },
    dolphin_share: d + o ? round(d / (d + o), 3) : null,
    dolphin: {
      ok_calls: dolphin.length,
      median_ms: Math.round(median(dolphin.map((a) => a.ms))),
      median_ttft_ms: ttft.length ? Math.round(median(ttft)) : null,
      median_tokens_per_s: speed.length ? round(median(speed)) : null,
    },
  };
}

/** Upper-bound cost of a run before it starts (printed by --kering; the run stops if it exceeds what is left). */
export function estimateRun(cfg: IzinConfig, bench: BenchConfig, n: { reads: number; serv_decisions: number; dolphin_decisions: number }) {
  const e = bench.estimate;
  const servModel = cfg.decider.model.endsWith(cfg.decider.suffix) ? cfg.decider.model.slice(0, -cfg.decider.suffix.length) : cfg.decider.model;
  const sp = cfg.prices_usd_per_mtok.serv[servModel] ?? { input: 0, output: 0 };
  const dp = cfg.prices_usd_per_mtok.dolphin[cfg.reader.primary.model] ?? { input: 0, output: 0 };
  const per = (p: { input: number; output: number }, i: number, o: number) => (i * p.input + o * p.output) / 1_000_000;
  const serv = n.serv_decisions * per(sp, e.decision_tokens_in, e.decision_tokens_out) * cfg.budget.serv_cost_factor;
  const dolphin = n.reads * per(dp, e.read_tokens_per_site, e.read_out_tokens_per_site) + n.dolphin_decisions * per(dp, e.decision_tokens_in, e.decision_tokens_out);
  return { serv_usd: round(serv, 4), dolphin_usd: round(dolphin, 4) };
}
