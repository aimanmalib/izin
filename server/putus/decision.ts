// The decider's answer (schema izin_decision_v1) and the code that checks it. The schema is sent
// to SERV when the rung allows it; the same rules are applied in code on every rung, because a
// model reply is never trusted for shape.
import type { IzinConfig, Verdict } from "../config.js";
import { VERDICTS } from "../config.js";
import { firstJsonObject } from "../baca/parse.js";

export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface Decision {
  verdict: Verdict;
  decisive_clause_ids: string[];
  reason: string;
  conditions: string[];
  missing: string[];
  confidence: Confidence;
  rules_applied: string[];
}

export function decisionSchema(cfg: IzinConfig) {
  const d = cfg.decider;
  const strings = (max: number) => ({ type: "array", items: { type: "string" }, maxItems: max });
  return {
    name: "izin_decision_v1",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: [...VERDICTS] },
        decisive_clause_ids: strings(d.max_decisive),
        reason: { type: "string" },
        conditions: strings(d.max_conditions),
        missing: strings(d.max_missing),
        confidence: { type: "string", enum: [...CONFIDENCE] },
        rules_applied: { type: "array", items: { type: "string", enum: [...RULE_IDS] } },
      },
      required: ["verdict", "decisive_clause_ids", "reason", "conditions", "missing", "confidence", "rules_applied"],
      additionalProperties: false,
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function stringList(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  return (v as string[]).map((s) => s.trim()).filter(Boolean).slice(0, max);
}

/**
 * Parses and checks a reply. Returns null when the reply is not a usable decision: no JSON,
 * a missing or out-of-vocabulary field, or extra fields. Lists longer than the limits are cut.
 */
export function parseDecision(reply: string, cfg: IzinConfig): Decision | null {
  const raw = firstJsonObject(reply.replace(/```[a-z]*\s*/giu, ""));
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const keys = ["verdict", "decisive_clause_ids", "reason", "conditions", "missing", "confidence", "rules_applied"];
  if (Object.keys(v).some((k) => !keys.includes(k))) return null;
  const d = cfg.decider;
  const verdict = v.verdict;
  const confidence = v.confidence;
  if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) return null;
  if (typeof confidence !== "string" || !(CONFIDENCE as readonly string[]).includes(confidence)) return null;
  if (typeof v.reason !== "string" || !v.reason.trim()) return null;
  const ids = stringList(v.decisive_clause_ids, d.max_decisive);
  const conditions = stringList(v.conditions, d.max_conditions);
  const missing = stringList(v.missing, d.max_missing);
  const rules = stringList(v.rules_applied, RULE_IDS.length);
  if (!ids || !conditions || !missing || !rules) return null;
  return {
    verdict: verdict as Verdict,
    decisive_clause_ids: [...new Set(ids)],
    reason: v.reason.trim(),
    conditions,
    missing,
    confidence: confidence as Confidence,
    // Unknown rule ids are dropped, not fatal: the list explains the verdict, it does not make it.
    rules_applied: [...new Set(rules.filter((r) => (RULE_IDS as readonly string[]).includes(r)))],
  };
}
