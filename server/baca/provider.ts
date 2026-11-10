// One chat completion against an OpenAI-compatible endpoint (Dolphin or SERV), with the rules of
// the reader: streamed with usage when the provider allows it, JSON mode dropped after a 400 and
// remembered for the process, one wait on 429 (Retry-After, capped), errors sorted into reasons.
import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { IzinConfig } from "../config.js";

export type ProviderCfg = IzinConfig["reader"]["primary"];

export type FailReason = "no_credit" | "server_error" | "timeout" | "rate_limited" | "network" | "no_key" | "bad_json" | `http_${number}`;

export class ReaderError extends Error {
  constructor(readonly reason: FailReason) {
    super(`reader: ${reason}`);
  }
}

export interface Usage {
  input: number;
  output: number;
  /** Reasoning tokens as billed by the provider, when it reports them. */
  reasoning: number | null;
}

export interface CallResult {
  content: string;
  response_model: string | null;
  usage: Usage | null;
  /** Streamed reasoning deltas seen (a count of chunks, not tokens). */
  reasoning_deltas: number;
  ms: number;
  ttft_ms: number | null;
  /** The reply came from a different model than requested, or via a relay named in config. */
  fallback_suspected: boolean;
}

export type ModelCall = (p: ProviderCfg, model: string, messages: ChatCompletionMessageParam[]) => Promise<CallResult>;

export interface CallDeps {
  cfg: IzinConfig;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const lastSegment = (m: string) => m.toLowerCase().split("/").pop() ?? "";

export function suspectFallback(requested: string, got: string | null, headers: Headers | null, markers: string[]): boolean {
  if (got && lastSegment(got) !== lastSegment(requested)) return true;
  if (!headers) return false;
  for (const [k, v] of headers) {
    const line = `${k}: ${v}`.toLowerCase();
    if (markers.some((m) => line.includes(m.toLowerCase()))) return true;
  }
  return false;
}

function classify(err: unknown, timedOut: boolean): ReaderError {
  if (err instanceof ReaderError) return err;
  if (timedOut) return new ReaderError("timeout");
  if (err instanceof APIError && typeof err.status === "number") {
    if (err.status === 402) return new ReaderError("no_credit");
    if (err.status === 429) return new ReaderError("rate_limited");
    if (err.status >= 500) return new ReaderError("server_error");
    return new ReaderError(`http_${err.status}`);
  }
  return new ReaderError("network");
}

function retryAfterMs(err: unknown, capS: number): number | null {
  if (!(err instanceof APIError) || err.status !== 429) return null;
  const raw = err.headers?.get("retry-after");
  const s = raw ? Number(raw) : NaN;
  if (!Number.isFinite(s) || s < 0) return null;
  return Math.min(s, capS) * 1000;
}

export function makeClient(p: ProviderCfg, deps: CallDeps): OpenAI {
  const apiKey = (deps.env ?? process.env)[p.key_env];
  if (!apiKey) throw new ReaderError("no_key");
  const timeout = deps.cfg.reader.timeout_ms;
  return new OpenAI({ apiKey, baseURL: p.base_url, maxRetries: 0, timeout, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
}

export function makeOpenAiCall(deps: CallDeps): ModelCall {
  const { cfg } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const clients = new Map<string, OpenAI>();
  const jsonModeOff = new Set<string>();
  const r = cfg.reader;

  const client = (p: ProviderCfg): OpenAI => {
    let c = clients.get(p.provider);
    if (!c) {
      c = makeClient(p, deps);
      clients.set(p.provider, c);
    }
    return c;
  };

  const once = async (p: ProviderCfg, model: string, messages: ChatCompletionMessageParam[]): Promise<CallResult> => {
    const c = client(p);
    const t0 = now();
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, r.timeout_ms);
    const base = {
      model,
      messages,
      temperature: r.temperature,
      max_tokens: r.max_tokens,
      ...(p.reasoning_effort ? { reasoning_effort: p.reasoning_effort } : {}),
      ...(jsonModeOff.has(p.provider) ? {} : { response_format: { type: "json_object" as const } }),
    };
    try {
      if (!p.stream) {
        const { data, response } = await c.chat.completions.create({ ...base, stream: false }, { signal: ac.signal }).withResponse();
        const u = data.usage;
        return {
          content: data.choices[0]?.message?.content ?? "",
          response_model: data.model ?? null,
          usage: u ? { input: u.prompt_tokens, output: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens ?? null } : null,
          reasoning_deltas: 0,
          ms: now() - t0,
          ttft_ms: null,
          fallback_suspected: suspectFallback(model, data.model ?? null, response.headers, r.fallback_suspect_markers),
        };
      }
      const { data: stream, response } = await c.chat.completions
        .create({ ...base, stream: true, stream_options: { include_usage: true } }, { signal: ac.signal })
        .withResponse();
      let content = "";
      let gotModel: string | null = null;
      let usage: Usage | null = null;
      let reasoningDeltas = 0;
      let ttft: number | null = null;
      for await (const chunk of stream) {
        if (chunk.model) gotModel = chunk.model;
        const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning?: string; reasoning_content?: string } | undefined;
        if (delta?.reasoning || delta?.reasoning_content) reasoningDeltas++;
        if (delta?.content) {
          if (ttft === null) ttft = now() - t0;
          content += delta.content;
        }
        const u = chunk.usage;
        if (u) usage = { input: u.prompt_tokens, output: u.completion_tokens, reasoning: u.completion_tokens_details?.reasoning_tokens ?? null };
      }
      return {
        content,
        response_model: gotModel,
        usage,
        reasoning_deltas: reasoningDeltas,
        ms: now() - t0,
        ttft_ms: ttft,
        fallback_suspected: suspectFallback(model, gotModel, response.headers, r.fallback_suspect_markers),
      };
    } catch (err) {
      throw Object.assign(classify(err, timedOut), { cause: err });
    } finally {
      clearTimeout(timer);
    }
  };

  return async (p, model, messages) => {
    let waited = false;
    for (;;) {
      try {
        return await once(p, model, messages);
      } catch (e) {
        const err = e as ReaderError & { cause?: unknown };
        if (err.reason === "http_400" && !jsonModeOff.has(p.provider)) {
          jsonModeOff.add(p.provider);
          continue;
        }
        const wait = waited ? null : retryAfterMs(err.cause, r.retry_after_max_s);
        if (wait !== null) {
          waited = true;
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  };
}

/** Picks the configured model if the provider lists it, otherwise the listed model with the largest context. */
export async function resolveModel(p: ProviderCfg, deps: CallDeps): Promise<{ model: string; substituted: boolean }> {
  const page = await makeClient(p, deps).models.list();
  const models = page.data as (OpenAI.Models.Model & { context_length?: number })[];
  if (models.some((m) => m.id === p.model) || models.length === 0) return { model: p.model, substituted: false };
  const best = [...models].sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))[0]!;
  return { model: best.id, substituted: true };
}
