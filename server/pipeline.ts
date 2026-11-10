// One check from input to receipt: collect -> read -> check quotes -> decide -> ceilings -> receipt.
// Every step's failure ends in ASK at best: GO needs a valid decision from the decider.
import { readFileSync } from "node:fs";
import { LANG_DIR, type Action, type IzinConfig } from "./config.js";
import type { Alert } from "./belanja/alerts.js";
import { readAll, type ReaderDeps } from "./baca/reader.js";
import { collect, type CollectInput } from "./kumpul/collect.js";
import type { NetPolicy } from "./kumpul/ssrf.js";
import { checkEvidence, numberDocs } from "./semak/check.js";
import { buildSignals, deciderInput, relevantClauses } from "./putus/message.js";
import { decide, type DeciderDeps, type DeciderResult } from "./putus/serv.js";
import { applyCeilings, type CeilingTexts } from "./putus/siling.js";
import { buildReceipt, newReceiptId, type Receipt } from "./resit/receipt.js";
import type { CheckSource, ReceiptStore } from "./resit/store.js";

export interface CheckInput extends CollectInput {
  action: Action;
  detail?: string;
}

export interface PipelineDeps {
  cfg: IzinConfig;
  reader: Omit<ReaderDeps, "cfg" | "alert">;
  decider: Omit<DeciderDeps, "cfg">;
  alert: Alert;
  texts: PipelineTexts;
  policy?: NetPolicy;
  sleep?: (ms: number) => Promise<void>;
  store?: ReceiptStore;
  source?: CheckSource;
  now?: () => Date;
  newId?: () => string;
}

export interface PipelineTexts {
  ceilings: CeilingTexts;
  disclaimer: string;
  action_labels: Record<Action, string>;
}

/** Receipt texts come from the English language file: the receipt JSON is the API's language. */
export function pipelineTexts(langDir: string = LANG_DIR): PipelineTexts {
  const en = JSON.parse(readFileSync(`${langDir}en.json`, "utf8")) as {
    actions: Record<Action, string>;
    receipt: CeilingTexts & { disclaimer: string };
  };
  const { disclaimer, ...ceilings } = en.receipt;
  return { ceilings, disclaimer, action_labels: en.actions };
}

export async function runCheck(input: CheckInput, deps: PipelineDeps): Promise<Receipt> {
  const { cfg } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = now().getTime();
  const created_at = now().toISOString();
  const detail = input.detail?.trim().slice(0, cfg.limits.detail_max_chars) || null;

  const collectInput: CollectInput = { url: input.url };
  if (input.terms_text !== undefined) collectInput.terms_text = input.terms_text;
  if (input.agent !== undefined) collectInput.agent = input.agent;
  if (input.policy_hints !== undefined) collectInput.policy_hints = input.policy_hints;
  const collected = await collect(
    collectInput,
    { cfg, ...(deps.policy ? { policy: deps.policy } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) },
  );
  const docs = numberDocs(collected.docs);
  const readings = await readAll({ ...deps.reader, cfg, alert: deps.alert }, docs.map((d) => ({ doc: d, id: d.id })));
  const evidence = checkEvidence(
    docs.map((d) => ({ doc: { id: d.id, kind: d.kind, url: d.url, text: d.text }, output: readings.find((r) => r.doc_id === d.id)?.output ?? null })),
    cfg,
  );
  const docRefs = docs.map((d) => ({ id: d.id, url: d.url, kind: d.kind, chars: d.text.length, truncated: d.state === "truncated" }));
  const signals = buildSignals(collected, docRefs, readings, evidence);
  const relevant = relevantClauses(cfg, input.action, evidence.clauses);
  const message = deciderInput({ action: input.action, action_label: deps.texts.action_labels[input.action], detail, site: collected.site }, signals, relevant);

  // With nothing read there is nothing to decide on: the ceilings already cap the verdict at ASK.
  const skip = signals.docs_read === 0 && relevant.length === 0;
  let decider: DeciderResult | null = null;
  if (!skip) {
    decider = await decide({ ...deps.decider, cfg }, JSON.stringify(message));
    if (decider.failure === "no_credit") await deps.alert("decider_no_credit");
  }
  const outcome = applyCeilings(
    {
      action: input.action,
      signals,
      blocked: collected.signals.blocked.map((b) => ({ url: b.url, status: b.status })),
      clauses: message.clauses,
      decision: decider?.decision ?? null,
      decider: skip ? "skipped" : decider?.decision ? "ok" : decider?.failure === "guard_tripped" ? "guard_tripped" : "unavailable",
      shadow_exhausted: decider?.shadow_exhausted ?? false,
    },
    deps.texts.ceilings,
  );

  const receipt = buildReceipt(cfg, {
    id: deps.newId?.() ?? newReceiptId(cfg.receipt.id_length),
    created_at,
    action: input.action,
    detail,
    collected,
    docs: docRefs,
    readings,
    evidence,
    signals,
    decider,
    outcome,
    rules_applied: decider?.decision?.rules_applied ?? [],
    ms_total: now().getTime() - t0,
    disclaimer: deps.texts.disclaimer,
  });
  if (deps.store) {
    deps.store.saveDocs(collected.docs, created_at);
    deps.store.saveExtractions(docs, readings, cfg.reader.prompt);
    deps.store.saveCheck(receipt, deps.source ?? "api");
  }
  return receipt;
}
