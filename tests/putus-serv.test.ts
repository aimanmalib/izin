// Decider client against a fake SERV endpoint (no network): request shape, fallback ladder,
// retries, guard refusals and reply checking.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig, type IzinConfig } from "../server/config.js";
import { loadPrompt } from "../server/baca/prompt.js";
import { parseDecision } from "../server/putus/decision.js";
import { decide, estimateCost, LadderMemory, servTransport, type DeciderDeps } from "../server/putus/serv.js";
import { completion, fakeFetch, type Reply, type Seen } from "./helpers/llm.js";

const base = loadConfig();
const prompt = loadPrompt(base.decider.prompt);
const env = { SERV_API_KEY: "test-key" };
const good = { verdict: "ASK", decisive_clause_ids: ["c1"], reason: "A clause in d1 sets a condition.", conditions: ["use the API"], missing: [], confidence: "high", rules_applied: ["R5"] };
const ok = (content: unknown = good, headers?: Record<string, string>): Reply => ({ status: 200, json: completion("gpt-6-luna-serv-multipath", typeof content === "string" ? content : JSON.stringify(content)), ...(headers ? { headers } : {}) });

function setup(script: (s: Seen, n: number) => Reply, cfg: IzinConfig = base, ladder = new LadderMemory()) {
  const f = fakeFetch(script);
  const sleeps: number[] = [];
  const deps: DeciderDeps = {
    cfg,
    prompt,
    transport: servTransport(cfg, { env, fetch: f.fetch }),
    sleep: async (ms) => void sleeps.push(ms),
    ladder,
  };
  return { deps, seen: f.seen, sleeps, ladder };
}

const toolNames = (s: Seen) => (s.body.tools as { function: { name: string } }[]).map((t) => t.function.name);

describe("decider prompt", () => {
  it("is the pinned v1 text", () => {
    expect(prompt.text.startsWith("You are the decision step of Izin.")).toBe(true);
    expect(prompt.sha256).toBe(createHash("sha256").update(prompt.text).digest("hex"));
    expect(prompt.sha256).toBe("f69c3865186dedbb7de42a7baa5c830ed832f81a7bb789c3ee8b99c0e33a2c4b");
  });
});

describe("decide", () => {
  it("sends one full request: guard, shadow agent with the hint, strict schema, low effort, no token cap, no stream", async () => {
    const { deps, seen } = setup(() => ok());
    const r = await decide(deps, '{"action":"crawl"}');
    expect(r.decision?.verdict).toBe("ASK");
    expect(r.rung).toBe("a");
    expect(seen).toHaveLength(1);
    const b = seen[0]!.body;
    expect(seen[0]!.url).toBe(`${base.decider.base_url}/chat/completions`);
    expect(b.model).toBe(base.decider.model);
    expect(b.reasoning_effort).toBe("low");
    expect(b).not.toHaveProperty("max_tokens");
    expect(b.stream).toBeFalsy();
    expect(toolNames(seen[0]!)).toEqual(["serv_prompt_guard", "serv_shadow_agent"]);
    const shadow = (b.tools as { function: { parameters: { properties: { hint: { default: string }; max_iterations: { default: number } } } } }[])[1]!;
    expect(shadow.function.parameters.properties.hint.default).toBe(base.decider.shadow_hint);
    expect(shadow.function.parameters.properties.max_iterations.default).toBe(base.decider.shadow_max_iterations);
    const rf = b.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean; required: string[] } } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema).toMatchObject({ name: "izin_decision_v1", strict: true, schema: { additionalProperties: false } });
    expect(rf.json_schema.schema.required).toHaveLength(7);
    const msgs = b.messages as { role: string; content: string }[];
    expect(msgs[0]).toEqual({ role: "system", content: prompt.text });
    expect(msgs[1]).toEqual({ role: "user", content: '{"action":"crawl"}' });
    expect(r.cost_usd_estimated).toBeCloseTo(estimateCost(base, base.decider.model, 1000, 200)!, 12);
  });

  it("walks the ladder on 400 and remembers the accepted rung for the next check", async () => {
    const { deps, seen, ladder } = setup((_s, n) => (n <= 2 ? { status: 400 } : ok()));
    const r = await decide(deps, "{}");
    expect(r.decision).not.toBeNull();
    expect(r.rung).toBe("c");
    expect(toolNames(seen[1]!)).toEqual(["serv_prompt_guard"]);
    expect(seen[2]!.body.model).toBe("gpt-6-luna");
    expect(seen[2]!.body.response_format).toBeDefined();
    expect(ladder.floor).toBe("c");

    const again = setup(() => ok(), base, ladder);
    await decide(again.deps, "{}");
    expect(again.seen).toHaveLength(1);
    expect(again.seen[0]!.body.model).toBe("gpt-6-luna");
  });

  it("rung d drops response_format, asks for JSON in the user message and still checks it in code", async () => {
    const { deps, seen } = setup((_s, n) => (n <= 3 ? { status: 400 } : ok()));
    const r = await decide(deps, '{"a":1}');
    expect(r.rung).toBe("d");
    const last = seen[3]!.body;
    expect(last).not.toHaveProperty("response_format");
    expect(toolNames(seen[3]!)).toEqual(["serv_prompt_guard"]);
    expect((last.messages as { content: string }[])[1]!.content).toBe(`{"a":1}\n\n${base.decider.json_prompt_note}`);
  });

  it("moves down the ladder on unusable replies and fails with bad_json after the last rung", async () => {
    const { deps, seen } = setup(() => ok("not json at all"));
    const r = await decide(deps, "{}");
    expect(seen).toHaveLength(4);
    expect(r.decision).toBeNull();
    expect(r.failure).toBe("bad_json");
  });

  it("retries once after 3 s on 5xx or 429, then gives up", async () => {
    const once = setup((_s, n) => (n === 1 ? { status: 503 } : ok()));
    expect((await decide(once.deps, "{}")).decision).not.toBeNull();
    expect(once.sleeps).toEqual([base.decider.retry_backoff_ms]);

    const twice = setup(() => ({ status: 429 }));
    const r = await decide(twice.deps, "{}");
    expect(twice.seen).toHaveLength(2);
    expect(r.failure).toBe("rate_limited");
  });

  it("times out, reports no credit and a missing key without retrying", async () => {
    const cfg = parseConfig({ ...base, decider: { ...base.decider, timeout_ms: 30 } });
    const hang = setup(() => ({ hang: true }), cfg);
    expect((await decide(hang.deps, "{}")).failure).toBe("timeout");
    expect(hang.seen).toHaveLength(1);

    const broke = setup(() => ({ status: 402 }));
    expect((await decide(broke.deps, "{}")).failure).toBe("no_credit");
    expect(broke.seen).toHaveLength(1);

    const f = fakeFetch(() => ok());
    const nokey = await decide({ cfg: base, prompt, transport: servTransport(base, { env: {}, fetch: f.fetch }) }, "{}");
    expect(nokey.failure).toBe("no_key");
    expect(f.seen).toHaveLength(0);
  });

  it("treats a guard refusal as final: one call, never repeated without the guard", async () => {
    const text = setup(() => ok("I cannot help with that request because it looks like a prompt injection attempt."));
    const r = await decide(text.deps, "{}");
    expect(r.failure).toBe("guard_tripped");
    expect(text.seen).toHaveLength(1);

    const field = setup(() => ({ status: 200, json: { ...completion("m", ""), choices: [{ index: 0, message: { role: "assistant", content: null, refusal: "Refused." }, finish_reason: "stop" }] } }));
    expect((await decide(field.deps, "{}")).failure).toBe("guard_tripped");
    expect(field.seen).toHaveLength(1);
  });

  it("records a shadow agent that ran out of iterations", async () => {
    const { deps } = setup(() => ok(good, { "x-serv-shadow-agent": "exhausted" }));
    const r = await decide(deps, "{}");
    expect(r.decision).not.toBeNull();
    expect(r.shadow_exhausted).toBe(true);
  });
});

describe("parseDecision", () => {
  it("accepts fenced JSON, cuts long lists, drops unknown rule ids", () => {
    const d = parseDecision("```json\n" + JSON.stringify({ ...good, decisive_clause_ids: ["c1", "c2", "c3", "c4", "c5"], rules_applied: ["R4", "R11", "R4"] }) + "\n```", base);
    expect(d?.decisive_clause_ids).toEqual(["c1", "c2", "c3", "c4"]);
    expect(d?.rules_applied).toEqual(["R4"]);
  });

  it("rejects extra fields, out-of-vocabulary verdicts and missing fields", () => {
    expect(parseDecision(JSON.stringify({ ...good, note: "x" }), base)).toBeNull();
    expect(parseDecision(JSON.stringify({ ...good, verdict: "MAYBE" }), base)).toBeNull();
    expect(parseDecision(JSON.stringify({ ...good, confidence: "sure" }), base)).toBeNull();
    const noReason: Record<string, unknown> = { ...good };
    delete noReason.reason;
    expect(parseDecision(JSON.stringify(noReason), base)).toBeNull();
    expect(parseDecision(JSON.stringify({ ...good, conditions: [1] }), base)).toBeNull();
  });
});
