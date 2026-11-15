// Builds the pipeline's dependencies for this process: real providers, or the offline fakes when
// IZIN_FAKE=1 (tests, local e2e, the CLI without keys).
import type { IzinConfig } from "./config.js";
import { makeAlert } from "./belanja/alerts.js";
import { MemoryReaderCache, type ReaderCache } from "./baca/cache.js";
import { loadPrompt } from "./baca/prompt.js";
import { readerCall } from "./baca/reader.js";
import { loadBenchConfig, variantConfig, variantTransport } from "./bench/variants.js";
import { fakeTransport } from "./putus/fake.js";
import { LadderMemory, servTransport } from "./putus/serv.js";
import { pipelineTexts, type PipelineDeps } from "./pipeline.js";

export function pipelineDeps(cfg: IzinConfig, opts: { env?: NodeJS.ProcessEnv; cache?: ReaderCache } = {}): PipelineDeps {
  const env = opts.env ?? process.env;
  const fake = env.IZIN_FAKE === "1";
  const prompt = loadPrompt(cfg.decider.prompt);
  const variant = cfg.decider.fallback_variant ? loadBenchConfig().variants.find((v) => v.id === cfg.decider.fallback_variant) : undefined;
  if (cfg.decider.fallback_variant && !variant) throw new Error(`decider.fallback_variant ${cfg.decider.fallback_variant} is not in config/bench.json`);
  return {
    ...(variant
      ? { fallback: { variant, decider: { cfg: variantConfig(cfg, variant), prompt, transport: fake ? fakeTransport() : variantTransport(cfg, variant, env), ladder: new LadderMemory() } } }
      : {}),
    cfg,
    reader: { prompt: loadPrompt(cfg.reader.prompt), call: readerCall(cfg, env), cache: opts.cache ?? new MemoryReaderCache() },
    decider: { prompt, transport: fake ? fakeTransport() : servTransport(cfg, { env }), ladder: new LadderMemory() },
    alert: makeAlert(cfg, { env }),
    texts: pipelineTexts(),
  };
}
