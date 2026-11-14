// Benchmark settings (config/bench.json) and the decider variants of PRD 4.11: the same message
// goes to each variant; only the endpoint, model and SERV features change. Nothing is hard-coded
// here: models, rungs and the tie rule come from the file.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ACTIONS, BENCH_CONFIG_PATH, type IzinConfig } from "../config.js";
import type { Spend } from "../belanja/guard.js";
import { makeOpenAiCall, ReaderError } from "../baca/provider.js";
import { DeciderHttpError, servTransport, type DeciderFail, type DeciderResult, type DeciderTransport } from "../putus/serv.js";

const positiveInt = z.number().int().positive();

export const benchConfigSchema = z
  .object({
    _comment: z.string().optional(),
    concurrency: positiveInt,
    gallery_concurrency: positiveInt,
    variants: z
      .array(
        z
          .object({
            id: z.string().regex(/^V\d$/),
            label: z.string().min(1),
            /** serv: the decider endpoint and key; dolphin: the primary reader's endpoint and key. */
            provider: z.enum(["serv", "dolphin"]),
            model: z.string().min(1),
            suffix: z.string().regex(/^-[a-z-]+$/),
            start_rung: z.enum(["a", "b", "c", "d"]),
            reasoning_effort: z.enum(["none", "low", "medium", "high"]),
            /** Prompt Guard as configured (flagged or always); false = never declared (no SERV). */
            guard: z.boolean(),
          })
          .strict(),
      )
      .min(1),
    tie_variant: z.string().regex(/^V\d$/),
    /** The SERV cost factor the committed benchmark run was priced with (it is priced again with the current one). */
    serv_cost_factor_of_saved_run: z.number().min(1),
    estimate: z
      .object({
        decision_tokens_in: positiveInt,
        decision_tokens_out: positiveInt,
        read_tokens_per_site: positiveInt,
        read_out_tokens_per_site: positiveInt,
      })
      .strict(),
    h1: z.object({ action: z.enum(ACTIONS), max_ms: positiveInt, hosts: z.array(z.string().min(1)).min(1) }).strict(),
  })
  .strict()
  .refine((c) => c.variants.some((v) => v.id === c.tie_variant), "tie_variant must be one of the variants");

export type BenchConfig = z.infer<typeof benchConfigSchema>;
export type Variant = BenchConfig["variants"][number];

export function loadBenchConfig(path: string = BENCH_CONFIG_PATH): BenchConfig {
  return benchConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** The process config with the decider pointed at one variant. */
export function variantConfig(cfg: IzinConfig, v: Variant): IzinConfig {
  const endpoint = v.provider === "serv" ? { base_url: cfg.decider.base_url, key_env: cfg.decider.key_env } : { base_url: cfg.reader.primary.base_url, key_env: cfg.reader.primary.key_env };
  return { ...cfg, decider: { ...cfg.decider, ...endpoint, model: v.model, suffix: v.suffix, start_rung: v.start_rung, reasoning_effort: v.reasoning_effort } };
}

const priced = (p: { input: number; output: number } | undefined, inTok: number, outTok: number): number | null =>
  p ? (inTok * p.input + outTok * p.output) / 1_000_000 : null;

/**
 * What one decision cost. SERV: the decider's own estimate (listed price times the SERV factor).
 * Dolphin: listed price, no factor (no SERV features run). An unlisted model takes the provider's highest price.
 */
export function variantSpend(cfg: IzinConfig, v: Variant, r: DeciderResult | null): Spend {
  if (!r) return { serv_usd: 0, dolphin_usd: 0 };
  if (v.provider === "serv") {
    const worst = Math.max(0, ...Object.values(cfg.prices_usd_per_mtok.serv).map((p) => p.input)) * r.tokens_in + Math.max(0, ...Object.values(cfg.prices_usd_per_mtok.serv).map((p) => p.output)) * r.tokens_out;
    return { serv_usd: r.cost_usd_estimated ?? (worst / 1_000_000) * cfg.budget.serv_cost_factor, dolphin_usd: 0 };
  }
  const prices = cfg.prices_usd_per_mtok.dolphin;
  const listed = priced(prices[v.model], r.tokens_in, r.tokens_out);
  const worst = (Math.max(0, ...Object.values(prices).map((p) => p.input)) * r.tokens_in + Math.max(0, ...Object.values(prices).map((p) => p.output)) * r.tokens_out) / 1_000_000;
  return { serv_usd: 0, dolphin_usd: listed ?? worst };
}

/**
 * The transport for one variant. Dolphin answers only when streamed (a plain request timed out when
 * measured), so the Dolphin-only line goes through the reader's streamed call: same messages, JSON
 * mode, no SERV features. SERV variants use the decider's own transport.
 */
export function variantTransport(cfg: IzinConfig, v: Variant, env: NodeJS.ProcessEnv = process.env): DeciderTransport {
  if (v.provider === "serv") return servTransport(variantConfig(cfg, v), { env });
  const call = makeOpenAiCall({ cfg, env });
  const p = { ...cfg.reader.primary, reasoning_effort: v.reasoning_effort };
  return async (body) => {
    try {
      const r = await call(p, body.model, body.messages);
      return { content: r.content, refusal: null, finish_reason: null, response_model: r.response_model, usage: r.usage ? { input: r.usage.input, output: r.usage.output } : null, request_id: null, extras: "", ms: r.ms };
    } catch (e) {
      if (e instanceof ReaderError) throw new DeciderHttpError(e.reason as DeciderFail, e.reason.startsWith("http_") ? Number(e.reason.slice(5)) : null);
      throw new DeciderHttpError("network", null);
    }
  };
}
