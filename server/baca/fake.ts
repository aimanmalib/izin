// Offline reader for IZIN_FAKE=1: builds a reply in the reader's JSON shape from simple keyword
// rules in fixtures/reader/rules.json. It lets tests and local e2e run the whole pipeline without
// any network call. It is not used in production.
import { readFileSync } from "node:fs";
import { FIXTURES_DIR, type IzinConfig } from "../config.js";
import { sentences } from "../semak/quarantine.js";
import type { ModelCall } from "./provider.js";

interface Rules {
  clause_rules: { pattern: string; category: string }[];
  stance_rules: { pattern: string; stance: string }[];
  addressed_rule: string;
  relevance_rule: string;
}

export function fakeReply(text: string, rules: Rules, cfg: IzinConfig): string {
  const re = (p: string) => new RegExp(p, "iu");
  const relevant = re(rules.relevance_rule);
  const addressedRe = re(rules.addressed_rule);
  const clauses: { quote: string; section: string; category: string; stance: string }[] = [];
  const addressed: string[] = [];
  for (const s of sentences(text)) {
    const quote = text.slice(s.start, s.end);
    if (addressedRe.test(quote)) {
      addressed.push(quote);
      continue;
    }
    if (quote.length < cfg.limits.quote_min_chars || quote.length > cfg.limits.quote_max_chars || !relevant.test(quote)) continue;
    const cat = rules.clause_rules.find((r) => re(r.pattern).test(quote));
    if (!cat) continue;
    const stance = rules.stance_rules.find((r) => re(r.pattern).test(quote))?.stance ?? "unclear";
    clauses.push({ quote, section: "", category: cat.category, stance });
    if (clauses.length >= cfg.reader.max_clauses) break;
  }
  return JSON.stringify({ clauses, addressed_to_ai: addressed, last_updated: null });
}

export function makeFakeCall(cfg: IzinConfig, dir: string = FIXTURES_DIR): ModelCall {
  const rules = JSON.parse(readFileSync(`${dir}reader/rules.json`, "utf8")) as Rules;
  return async (_p, model, messages) => {
    const user = String(messages[messages.length - 1]?.content ?? "");
    const text = user.slice(user.indexOf("\n\n") + 2);
    const content = fakeReply(text, rules, cfg);
    const tokens = Math.ceil(user.length / 4);
    return {
      content,
      response_model: model,
      usage: { input: tokens, output: Math.ceil(content.length / 4), reasoning: null },
      reasoning_deltas: 0,
      ms: 1,
      ttft_ms: 1,
      fallback_suspected: false,
    };
  };
}
