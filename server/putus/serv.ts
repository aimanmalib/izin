// The decision step on SERV Reasoning: one non-streamed call with Prompt Guard and Shadow Agent,
// a strict JSON schema, and a fallback ladder when SERV rejects the combination (400) or the
// reply is not a usable decision:
//   (a) full -> (b) without shadow agent -> (c) model without the feature suffix
//   -> (d) without response_format, JSON asked for in the user message and checked in code.
// A rung that got a 400 is remembered for the process. A guard refusal is final for the check:
// the request is never repeated without the guard.
import OpenAI, { APIError } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { IzinConfig } from "../config.js";
import type { Prompt } from "../baca/prompt.js";
import { decisionSchema, parseDecision, type Decision } from "./decision.js";

export const RUNGS = ["a", "b", "c", "d"] as const;
export type Rung = (typeof RUNGS)[number];

export type DeciderFail =
  | "timeout"
  | "server_error"
  | "rate_limited"
  | "network"
  | "no_key"
  | "no_credit"
  | "bad_json"
  | "guard_tripped"
  | "calls_exhausted"
  | `http_${number}`;

/** What a transport returns for one completed HTTP call. */
export interface RawReply {
  content: string;
  refusal: string | null;
  finish_reason: string | null;
  response_model: string | null;
  usage: { input: number; output: number } | null;
  request_id: string | null;
  /** Response header lines and non-standard body fields, lower-cased, for outcome markers. */
  extras: string;
  ms: number;
}

export class DeciderHttpError extends Error {
  constructor(
    readonly reason: DeciderFail,
    readonly status: number | null,
  ) {
    super(`decider: ${reason}`);
  }
}

export type DeciderTransport = (body: ChatCompletionCreateParamsNonStreaming) => Promise<RawReply>;

export interface DeciderAttempt {
  rung: Rung;
  model: string;
  outcome: "ok" | DeciderFail;
  status: number | null;
  ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  request_id: string | null;
}

export interface DeciderResult {
  decision: Decision | null;
  /** Null on success; the reason the last attempt failed otherwise. */
  failure: DeciderFail | null;
  rung: Rung;
  model: string;
  prompt_version: string;
  attempts: DeciderAttempt[];
  tokens_in: number;
  tokens_out: number;
  cost_usd_estimated: number | null;
  ms: number;
  request_id: string | null;
  shadow_exhausted: boolean;
  /** Whether serv_prompt_guard was declared on this check's requests. */
  prompt_guard: boolean;
}

export interface DeciderDeps {
  cfg: IzinConfig;
  prompt: Prompt;
  transport: DeciderTransport;
  sleep?: (ms: number) => Promise<void>;
  /** Shared per process: the lowest rung known to be accepted. */
  ladder?: LadderMemory;
}

export class LadderMemory {
  floor: Rung | null = null;
}

export function baseModel(cfg: IzinConfig, model: string = cfg.decider.model): string {
  const s = cfg.decider.suffix;
  return model.endsWith(s) ? model.slice(0, -s.length) : model;
}

/** Estimate: listed price of the base model times the configured factor for SERV's extra calls. */
export function estimateCost(cfg: IzinConfig, model: string, inTok: number, outTok: number): number | null {
  const price = cfg.prices_usd_per_mtok.serv[baseModel(cfg, model)];
  if (!price) return null;
  return ((inTok * price.input + outTok * price.output) / 1_000_000) * cfg.budget.serv_cost_factor;
}

export function requestFor(cfg: IzinConfig, prompt: Prompt, userJson: string, rung: Rung, guard = true): ChatCompletionCreateParamsNonStreaming {
  const d = cfg.decider;
  const level = RUNGS.indexOf(rung);
  const model = level >= 2 ? baseModel(cfg) : d.model;
  const tools: NonNullable<ChatCompletionCreateParamsNonStreaming["tools"]> = guard ? [{ type: "function", function: { name: "serv_prompt_guard" } }] : [];
  if (level === 0) {
    tools.push({
      type: "function",
      function: {
        name: "serv_shadow_agent",
        description: "Enable SERV shadow-agent validation.",
        parameters: {
          type: "object",
          properties: {
            hint: { type: "string", default: d.shadow_hint },
            max_iterations: { type: "integer", default: d.shadow_max_iterations },
          },
        },
      },
    });
  }
  return {
    model,
    reasoning_effort: d.reasoning_effort,
    messages: [
      { role: "system", content: prompt.text },
      { role: "user", content: level === 3 ? `${userJson}\n\n${d.json_prompt_note}` : userJson },
    ],
    ...(tools.length ? { tools } : {}),
    ...(level < 3 ? { response_format: { type: "json_schema" as const, json_schema: decisionSchema(cfg) } } : {}),
  };
}

function looksLikeGuardRefusal(cfg: IzinConfig, r: RawReply): boolean {
  if (r.refusal) return true;
  if (r.finish_reason === "content_filter") return true;
  const text = r.content.toLowerCase();
  return cfg.decider.guard_refusal_markers.some((m) => text.includes(m.toLowerCase()));
}

function shadowExhausted(cfg: IzinConfig, r: RawReply): boolean {
  return /shadow/.test(r.extras) && cfg.decider.shadow_exhausted_markers.some((m) => r.extras.includes(m.toLowerCase()));
}

export async function decide(deps: DeciderDeps, userJson: string, opts: { guard?: boolean } = {}): Promise<DeciderResult> {
  const guard = opts.guard ?? true;
  const { cfg, prompt, transport } = deps;
  const d = cfg.decider;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ladder = deps.ladder ?? new LadderMemory();
  const startAt = Math.max(RUNGS.indexOf(d.start_rung), ladder.floor ? RUNGS.indexOf(ladder.floor) : 0);
  const attempts: DeciderAttempt[] = [];
  let level = startAt;
  let retriesLeft = d.retries;
  let failure: DeciderFail = "calls_exhausted";
  let last: RawReply | null = null;
  let decision: Decision | null = null;
  let exhausted = false;

  while (level < RUNGS.length && attempts.length < d.max_calls) {
    const rung = RUNGS[level]!;
    const body = requestFor(cfg, prompt, userJson, rung, guard);
    try {
      const r = await transport(body);
      last = r;
      exhausted ||= shadowExhausted(cfg, r);
      decision = parseDecision(r.content, cfg);
      const outcome = decision ? "ok" : looksLikeGuardRefusal(cfg, r) ? "guard_tripped" : "bad_json";
      attempts.push({ rung, model: body.model, outcome, status: 200, ms: r.ms, input_tokens: r.usage?.input ?? null, output_tokens: r.usage?.output ?? null, request_id: r.request_id });
      if (decision) break;
      failure = outcome as DeciderFail;
      if (outcome === "guard_tripped") break;
      level++;
    } catch (e) {
      const err = e instanceof DeciderHttpError ? e : new DeciderHttpError("network", null);
      attempts.push({ rung, model: body.model, outcome: err.reason, status: err.status, ms: 0, input_tokens: null, output_tokens: null, request_id: null });
      failure = err.reason;
      if (err.status === 400) {
        ladder.floor = RUNGS[Math.min(level + 1, RUNGS.length - 1)]!;
        level++;
        continue;
      }
      if ((err.reason === "server_error" || err.reason === "rate_limited") && retriesLeft > 0) {
        retriesLeft--;
        await sleep(d.retry_backoff_ms);
        continue;
      }
      break;
    }
  }

  const used = attempts[attempts.length - 1];
  const tokens_in = attempts.reduce((s, a) => s + (a.input_tokens ?? 0), 0);
  const tokens_out = attempts.reduce((s, a) => s + (a.output_tokens ?? 0), 0);
  const costs = attempts.filter((a) => a.input_tokens !== null).map((a) => estimateCost(cfg, a.model, a.input_tokens!, a.output_tokens ?? 0));
  return {
    decision,
    failure: decision ? null : failure,
    rung: used?.rung ?? RUNGS[startAt]!,
    model: used?.model ?? d.model,
    prompt_version: prompt.name,
    attempts,
    tokens_in,
    tokens_out,
    cost_usd_estimated: costs.length && costs.every((c) => c !== null) ? costs.reduce((s, c) => s + c!, 0) : costs.length ? null : 0,
    ms: attempts.reduce((s, a) => s + a.ms, 0),
    request_id: last?.request_id ?? null,
    shadow_exhausted: exhausted,
    prompt_guard: guard,
  };
}

const STANDARD_KEYS = new Set(["id", "object", "created", "model", "choices", "usage", "system_fingerprint", "service_tier"]);

function classify(err: unknown, timedOut: boolean): DeciderHttpError {
  if (err instanceof DeciderHttpError) return err;
  if (timedOut) return new DeciderHttpError("timeout", null);
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    const reason: DeciderFail = s === 402 ? "no_credit" : s === 429 ? "rate_limited" : s >= 500 ? "server_error" : `http_${s}`;
    return new DeciderHttpError(reason, s);
  }
  return new DeciderHttpError("network", null);
}

/** The real transport: OpenAI SDK against SERV, no SDK retries, a hard time limit per call. */
export function servTransport(cfg: IzinConfig, opts: { env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch; now?: () => number } = {}): DeciderTransport {
  const d = cfg.decider;
  const now = opts.now ?? Date.now;
  let client: OpenAI | null = null;
  return async (body) => {
    const apiKey = (opts.env ?? process.env)[d.key_env];
    if (!apiKey) throw new DeciderHttpError("no_key", null);
    client ??= new OpenAI({ apiKey, baseURL: d.base_url, maxRetries: 0, timeout: d.timeout_ms, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, d.timeout_ms);
    const t0 = now();
    try {
      const { data, response } = await client.chat.completions.create(body, { signal: ac.signal }).withResponse();
      const choice = data.choices[0];
      const extras = [
        ...[...response.headers].map(([k, v]) => `${k}: ${v}`),
        ...Object.entries(data)
          .filter(([k]) => !STANDARD_KEYS.has(k))
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
      ]
        .join("\n")
        .toLowerCase();
      return {
        content: choice?.message?.content ?? "",
        refusal: choice?.message?.refusal ?? null,
        finish_reason: choice?.finish_reason ?? null,
        response_model: data.model ?? null,
        usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : null,
        request_id: response.headers.get("x-request-id") ?? data.id ?? null,
        extras,
        ms: now() - t0,
      };
    } catch (err) {
      // The provider's error text (no request data) is kept for measurement runs and logs.
      throw Object.assign(classify(err, timedOut), { detail: err instanceof APIError ? err.message.slice(0, 300) : undefined });
    } finally {
      clearTimeout(timer);
    }
  };
}
