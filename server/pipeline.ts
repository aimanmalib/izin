// One check from input to receipt: collect -> read -> check quotes -> decide -> ceilings -> receipt.
// Every step's failure ends in ASK at best: GO needs a valid decision from the decider.
import { readFileSync } from "node:fs";
import { LANG_DIR, type Action, type IzinConfig } from "./config.js";
import type { Alert } from "./belanja/alerts.js";
import { spendOf, type Spend } from "./belanja/guard.js";
import { readAll, type ReaderDeps } from "./baca/reader.js";
import { collect, type CollectInput } from "./kumpul/collect.js";
import type { NetPolicy } from "./kumpul/ssrf.js";
import { checkEvidence, numberDocs } from "./semak/check.js";
import { buildSignals, deciderInput, guardFor, relevantClauses, type DocRef } from "./putus/message.js";
import { decide, type DeciderDeps, type DeciderResult } from "./putus/serv.js";
import { variantSpend, type Variant } from "./bench/variants.js";
import { applyCeilings, QUOTE_REQUIRED, type CeilingTexts } from "./putus/siling.js";
import { buildReceipt, newReceiptId, type FetchedLabels, type Receipt } from "./resit/receipt.js";
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
  /** Called once per check with what it cost on each provider (before the receipt is built). */
  onSpend?: (spend: Spend) => void;
  /**
   * The decider that answers when SERV has no credit or its spending cap is reached: an open model on
   * Dolphin under the same rulebook and the same code ceilings (ADR 0024). Absent = no fallback.
   */
  fallback?: { variant: Variant; decider: DeciderDeps };
  /** True when the SERV cap is reached for this check's source, so SERV is not called at all. */
  servCapped?: () => boolean;
}

export interface PipelineTexts {
  ceilings: CeilingTexts;
  disclaimer: string;
  action_labels: Record<Action, string>;
  fetched: FetchedLabels;
}

/** Receipt texts come from the English language file: the receipt JSON is the API's language. */
export function pipelineTexts(langDir: string = LANG_DIR): PipelineTexts {
  const en = JSON.parse(readFileSync(`${langDir}en.json`, "utf8")) as {
    actions: Record<Action, string>;
    receipt: CeilingTexts & { disclaimer: string; fetched: FetchedLabels };
  };
  const { disclaimer, fetched, ...ceilings } = en.receipt;
  return { ceilings, disclaimer, fetched, action_labels: en.actions };
}

/** Everything a check knows before the decider is asked: shared by every decider variant of a benchmark. */
export interface PreparedCheck {
  input: CheckInput;
  t0: number;
  created_at: string;
  detail: string | null;
  collected: Awaited<ReturnType<typeof collect>>;
  docs: ReturnType<typeof numberDocs>;
  docRefs: (DocRef & { id: string })[];
  readings: Awaited<ReturnType<typeof readAll>>;
  evidence: ReturnType<typeof checkEvidence>;
  signals: ReturnType<typeof buildSignals>;
  message: ReturnType<typeof deciderInput>;
  /** With nothing read there is nothing to decide on: the ceilings already cap the verdict at ASK. */
  skip: boolean;
  /** Whether Prompt Guard is declared for this message (config guard mode). */
  guard: boolean;
}

/** Collect, read, check quotes and build the decider's message. */
export async function prepareCheck(input: CheckInput, deps: PipelineDeps): Promise<PreparedCheck> {
  const { cfg } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = now().getTime();
  const created_at = now().toISOString();
  const detail = input.detail?.trim().slice(0, cfg.limits.detail_max_chars) || null;

  const collectInput: CollectInput = { url: input.url, action: input.action };
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
  // Nothing read and no clause, or no clause at all for an action where silence is not permission (S11):
  // the ceilings already fix the verdict at ASK or below, so no decision is requested and nothing is spent.
  const skip = relevant.length === 0 && (signals.docs_read === 0 || QUOTE_REQUIRED.includes(input.action));
  return { input, t0, created_at, detail, collected, docs, docRefs, readings, evidence, signals, message, skip, guard: !skip && guardFor(cfg, message) };
}

/** The code ceilings over a decider result (null = not asked). */
/** What the ceilings need from a prepared check; a benchmark case rebuilt from frozen evidence has exactly this. */
export interface Decidable {
  input: { action: Action };
  signals: PreparedCheck["signals"];
  message: PreparedCheck["message"];
  skip: boolean;
  guard: boolean;
  collected: { signals: { blocked: { url: string; status: number }[] } };
}

export function outcomeOf(p: Decidable, decider: DeciderResult | null, texts: PipelineTexts) {
  return applyCeilings(
    {
      action: p.input.action,
      signals: p.signals,
      blocked: p.collected.signals.blocked.map((b) => ({ url: b.url, status: b.status })),
      clauses: p.message.clauses,
      decision: decider?.decision ?? null,
      decider: p.skip ? "skipped" : decider?.decision ? "ok" : decider?.failure === "guard_tripped" ? "guard_tripped" : "unavailable",
      shadow_exhausted: decider?.shadow_exhausted ?? false,
    },
    texts.ceilings,
  );
}

/** Ceilings, receipt, storage. `saveInputs: false` stores only the receipt (the reading was stored already). */
export function finishCheck(p: PreparedCheck, decider: DeciderResult | null, deps: PipelineDeps, opts: { saveInputs?: boolean } = {}): Receipt {
  const { cfg } = deps;
  const now = deps.now ?? (() => new Date());
  const outcome = outcomeOf(p, decider, deps.texts);
  const receipt = buildReceipt(cfg, {
    id: deps.newId?.() ?? newReceiptId(cfg.receipt.id_length),
    created_at: p.created_at,
    action: p.input.action,
    detail: p.detail,
    collected: p.collected,
    docs: p.docRefs,
    readings: p.readings,
    evidence: p.evidence,
    signals: p.signals,
    decider,
    outcome,
    rules_applied: decider?.decision?.rules_applied ?? [],
    ms_total: now().getTime() - p.t0,
    disclaimer: deps.texts.disclaimer,
    fetched_labels: deps.texts.fetched,
  });
  if (deps.store) {
    if (opts.saveInputs !== false) {
      deps.store.saveDocs(p.collected.docs, p.created_at);
      deps.store.saveExtractions(p.docs, p.readings, cfg.reader.prompt);
    }
    deps.store.saveCheck(receipt, deps.source ?? "api", p.input.agent ?? null);
  }
  return receipt;
}

/** The shipped decider over a prepared check, then the receipt (what every live check does after reading). */
export async function decideAndFinish(p: PreparedCheck, deps: PipelineDeps): Promise<Receipt> {
  let decider: DeciderResult | null = null;
  let spend = spendOf(deps.cfg, p.readings, null);
  if (!p.skip) {
    const message = JSON.stringify(p.message);
    const capped = !!deps.fallback && !!deps.servCapped?.();
    if (!capped) {
      decider = await decide({ ...deps.decider, cfg: deps.cfg }, message, { guard: p.guard });
      if (decider.failure === "no_credit") await deps.alert("decider_no_credit");
      spend = spendOf(deps.cfg, p.readings, decider);
    }
    if (deps.fallback && (capped || decider?.failure === "no_credit")) {
      // SERV features (Shadow Agent, Prompt Guard) do not exist here; the code ceilings still apply in finishCheck.
      const r = await decide(deps.fallback.decider, message, { guard: false });
      const cost = variantSpend(deps.cfg, deps.fallback.variant, r);
      decider = { ...r, cost_usd_estimated: cost.dolphin_usd, fallback: true };
      spend = { serv_usd: spend.serv_usd, dolphin_usd: spend.dolphin_usd + cost.dolphin_usd };
    }
  }
  deps.onSpend?.(spend);
  return finishCheck(p, decider, deps);
}

export async function runCheck(input: CheckInput, deps: PipelineDeps): Promise<Receipt> {
  return decideAndFinish(await prepareCheck(input, deps), deps);
}
