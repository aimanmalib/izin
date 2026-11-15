// Reads each collected document with the primary reader (Dolphin) and falls back to SERV when it
// fails: no credit, server error, timeout, or no valid JSON after one retry. Text a site marked
// ai-input=no is never sent to any model, and neither is a page whose text Izin could not get.
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { IzinConfig } from "../config.js";
import type { Alert } from "../belanja/alerts.js";
import type { PolicyDoc } from "../kumpul/types.js";
import { cacheKey, type ReaderCache } from "./cache.js";
import { parseReaderReply } from "./parse.js";
import type { Prompt } from "./prompt.js";
import { makeFakeCall } from "./fake.js";
import { makeOpenAiCall, ReaderError, type CallResult, type FailReason, type ModelCall, type ProviderCfg } from "./provider.js";
import type { ReaderOutput } from "./types.js";

export interface Attempt {
  provider: string;
  model: string;
  outcome: "ok" | FailReason;
  ms: number;
  ttft_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  reasoning_deltas: number;
  cost_usd: number | null;
  response_model: string | null;
  fallback_suspected: boolean;
}

export interface DocReading {
  doc_id: string;
  status: "read" | "skipped" | "failed";
  /** "needs_browser": the collector got no readable text from the page, so there is nothing to read. */
  skip_reason?: "ai_input_no" | "needs_browser";
  output: ReaderOutput | null;
  /** e.g. "dolphin:<model>" or "serv:gpt-6-luna (fallback: no_credit)". */
  reader: string | null;
  cached: boolean;
  fail_reasons: FailReason[];
  attempts: Attempt[];
  cost_usd: number;
  fallback_suspected: boolean;
}

export interface ReaderDeps {
  cfg: IzinConfig;
  prompt: Prompt;
  call: ModelCall;
  cache: ReaderCache;
  alert: Alert;
  /** Model actually used for the primary provider (after the boot-time model check). */
  primaryModel?: string;
}

export function costUsd(cfg: IzinConfig, provider: string, model: string, inTok: number, outTok: number): number | null {
  const table = cfg.prices_usd_per_mtok[provider as "serv" | "dolphin"];
  const price = table?.[model];
  if (!price) return null;
  return (inTok * price.input + outTok * price.output) / 1_000_000;
}

function attemptOf(cfg: IzinConfig, p: ProviderCfg, model: string, r: CallResult | null, outcome: Attempt["outcome"]): Attempt {
  const inTok = r?.usage?.input ?? null;
  const outTok = r?.usage?.output ?? null;
  return {
    provider: p.provider,
    model,
    outcome,
    ms: r?.ms ?? 0,
    ttft_ms: r?.ttft_ms ?? null,
    input_tokens: inTok,
    output_tokens: outTok,
    reasoning_tokens: r?.usage?.reasoning ?? null,
    reasoning_deltas: r?.reasoning_deltas ?? 0,
    cost_usd: inTok !== null && outTok !== null ? costUsd(cfg, p.provider, model, inTok, outTok) : null,
    response_model: r?.response_model ?? null,
    fallback_suspected: r?.fallback_suspected ?? false,
  };
}

export function readerMessages(prompt: Prompt, doc: PolicyDoc, extra?: string): ChatCompletionMessageParam[] {
  const kind = doc.kind === "pasted" ? "pasted" : "policy";
  const user = `URL: ${doc.url}\nKIND: ${kind}\n\n${doc.text}${extra ? `\n\n${extra}` : ""}`;
  return [
    { role: "system", content: prompt.text },
    { role: "user", content: user },
  ];
}

/** One provider: call, parse, and on unparseable output call once more with the retry note. */
async function tryProvider(deps: ReaderDeps, p: ProviderCfg, model: string, doc: PolicyDoc, attempts: Attempt[]): Promise<ReaderOutput> {
  for (const extra of [undefined, deps.cfg.reader.json_retry_note]) {
    let r: CallResult;
    try {
      r = await deps.call(p, model, readerMessages(deps.prompt, doc, extra));
    } catch (e) {
      const reason = e instanceof ReaderError ? e.reason : "network";
      attempts.push(attemptOf(deps.cfg, p, model, null, reason));
      throw e instanceof ReaderError ? e : new ReaderError(reason);
    }
    const out = parseReaderReply(r.content);
    attempts.push(attemptOf(deps.cfg, p, model, r, out ? "ok" : "bad_json"));
    if (out) return out;
  }
  throw new ReaderError("bad_json");
}

export async function readDoc(deps: ReaderDeps, doc: PolicyDoc, docId: string): Promise<DocReading> {
  const { cfg, cache, prompt } = deps;
  const base = { doc_id: docId, cached: false, fail_reasons: [] as FailReason[], attempts: [] as Attempt[] };
  const skipped = (skip_reason: NonNullable<DocReading["skip_reason"]>): DocReading => ({ ...base, status: "skipped", skip_reason, output: null, reader: null, cost_usd: 0, fallback_suspected: false });
  if (!doc.to_model) return skipped("ai_input_no");
  // A page the collector already marked as unreadable (it needs a browser, or its text is shorter than
  // the minimum) is not sent to a model: no call, no cost. A page cut at the maximum length is still read.
  if (doc.state === "needs_browser") return skipped("needs_browser");
  const primary = cfg.reader.primary;
  const fallback = cfg.reader.fallback;
  const plan: [ProviderCfg, string][] = [
    [primary, deps.primaryModel ?? primary.model],
    [fallback, fallback.model],
  ];
  for (const [p, model] of plan) {
    const hit = cache.get(cacheKey(doc.text, p.provider, model, prompt.name));
    if (hit) return { ...base, status: "read", output: hit.output, reader: hit.reader, cached: true, cost_usd: 0, fallback_suspected: false };
  }

  const done = (output: ReaderOutput | null, reader: string | null): DocReading => ({
    ...base,
    status: output ? "read" : "failed",
    output,
    reader,
    cost_usd: base.attempts.reduce((s, a) => s + (a.cost_usd ?? 0), 0),
    fallback_suspected: base.attempts.some((a) => a.fallback_suspected),
  });

  for (const [i, [p, model]] of plan.entries()) {
    try {
      const output = await tryProvider(deps, p, model, doc, base.attempts);
      const reader = i === 0 ? `${p.provider}:${model}` : `${p.provider}:${model} (fallback: ${base.fail_reasons.join(", ")})`;
      cache.set(cacheKey(doc.text, p.provider, model, prompt.name), { output, reader });
      return done(output, reader);
    } catch (e) {
      const reason = e instanceof ReaderError ? e.reason : "network";
      base.fail_reasons.push(reason);
      if (reason === "no_credit" && p.provider === "dolphin") await deps.alert("reader_no_credit");
    }
  }
  return done(null, null);
}

/** Reads documents one after another (the request budget is per check, not per document). */
export async function readAll(deps: ReaderDeps, docs: { doc: PolicyDoc; id: string }[]): Promise<DocReading[]> {
  const out: DocReading[] = [];
  for (const { doc, id } of docs) out.push(await readDoc(deps, doc, id));
  return out;
}

/** The model call for this process: the offline fake under IZIN_FAKE=1, the real providers otherwise. */
export function readerCall(cfg: IzinConfig, env: NodeJS.ProcessEnv = process.env): ModelCall {
  return env.IZIN_FAKE === "1" ? makeFakeCall(cfg) : makeOpenAiCall({ cfg, env });
}
