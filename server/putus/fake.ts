// Offline decider for IZIN_FAKE=1 (tests and local e2e). It reads the same user message SERV
// would get and applies a small subset of the rulebook in code, so the whole pipeline runs
// without network. A detail that matches an injection pattern gets a guard-style refusal.
// It is not used in production and its answers are not evidence of how SERV decides.
import { readFileSync } from "node:fs";
import { FIXTURES_DIR } from "../config.js";
import type { DeciderInput } from "./message.js";
import type { DeciderTransport } from "./serv.js";

export function fakeDecision(input: DeciderInput) {
  const s = input.signals;
  const unread = s.docs_read === 0 || s.unreadable.length > 0 || s.blocked_reader;
  const by = (stance: string) => input.clauses.filter((c) => c.stance === stance);
  const prohibits = by("prohibits");
  const conditional = [...by("requires"), ...by("restricts")];
  const permits = by("permits");
  const base = { conditions: [] as string[], missing: [] as string[], decisive_clause_ids: [] as string[], rules_applied: [] as string[] };
  if (prohibits.length) {
    return { ...base, verdict: "NO_GO", decisive_clause_ids: prohibits.slice(0, 2).map((c) => c.id), reason: `A clause in ${prohibits[0]!.doc} prohibits this action.`, confidence: "high", rules_applied: ["R4"] };
  }
  if (unread) {
    const missing = [...s.unreadable.map((u) => `${u.url} (${u.why})`), ...(s.docs_read === 0 ? ["no policy document was read"] : [])].slice(0, 3);
    return { ...base, verdict: "ASK", missing: missing.length ? missing : ["the site blocked the reader"], reason: "Some documents could not be read in full.", confidence: "medium", rules_applied: ["R3"] };
  }
  if (conditional.length) {
    return { ...base, verdict: "ASK", decisive_clause_ids: conditional.slice(0, 2).map((c) => c.id), conditions: conditional.slice(0, 3).map((c) => c.quote.slice(0, 160)), reason: `A clause in ${conditional[0]!.doc} sets a condition.`, confidence: "high", rules_applied: ["R5"] };
  }
  if (permits.length) {
    return { ...base, verdict: "GO", decisive_clause_ids: [permits[0]!.id], reason: `A clause in ${permits[0]!.doc} permits this action.`, confidence: "high", rules_applied: ["R7"] };
  }
  if (input.action === "train") return { ...base, verdict: "ASK", missing: ["a licence to train on content"], reason: "The documents are silent on training.", confidence: "medium", rules_applied: ["R8"] };
  return { ...base, verdict: "GO", reason: "The documents read in full are silent on this action.", confidence: "medium", rules_applied: ["R8"] };
}

export function fakeTransport(dir: string = FIXTURES_DIR): DeciderTransport {
  const rules = JSON.parse(readFileSync(`${dir}decider/guard.json`, "utf8")) as { patterns: string[] };
  const patterns = rules.patterns.map((p) => new RegExp(p, "iu"));
  return async (body) => {
    const user = String(body.messages[body.messages.length - 1]?.content ?? "");
    const input = JSON.parse(user.slice(0, user.lastIndexOf("}") + 1)) as DeciderInput;
    const guarded = body.tools?.some((t) => t.type === "function" && t.function.name === "serv_prompt_guard");
    const tokens = { input: Math.ceil(user.length / 4), output: 80 };
    if (guarded && input.detail && patterns.some((p) => p.test(input.detail!))) {
      return { content: "I cannot help with that request because it looks like a prompt injection attempt.", refusal: null, finish_reason: "stop", response_model: body.model, usage: tokens, request_id: "fake", extras: "", ms: 1 };
    }
    const content = JSON.stringify(fakeDecision(input));
    return { content, refusal: null, finish_reason: "stop", response_model: body.model, usage: tokens, request_id: "fake", extras: "", ms: 1 };
  };
}
