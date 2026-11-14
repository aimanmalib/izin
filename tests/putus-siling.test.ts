// Code ceilings S1 to S10: each one, the R6 case, and failures that must never end in GO.
import { describe, expect, it } from "vitest";
import type { Action, Verdict } from "../server/config.js";
import en from "../lang/en.json" with { type: "json" };
import type { Decision } from "../server/putus/decision.js";
import type { DeciderClause, DeciderSignals } from "../server/putus/message.js";
import { applyCeilings, signalCeilings, strictest, type CeilingInput, type CeilingTexts } from "../server/putus/siling.js";

const texts: CeilingTexts = en.receipt;

const signals = (over: Partial<DeciderSignals> = {}, robots: Partial<DeciderSignals["robots"]> = {}): DeciderSignals => ({
  robots: { fetched: true, disallow_for_agent: false, crawl_delay: null, content_signal: {}, ...robots },
  blocked_reader: false,
  docs_read: 1,
  docs: [{ id: "d1", url: "https://shop.example/terms", kind: "policy", chars: 2000, truncated: false }],
  unreadable: [],
  addressed_to_ai_found: false,
  ...over,
});

const clause = (id: string, stance: string, category = "automated_access"): DeciderClause => ({ id, doc: "d1", section: "", category, stance, quote: `Synthetic clause ${id} long enough to be a quote for the tests.` });

const decision = (verdict: Verdict, ids: string[] = [], over: Partial<Decision> = {}): Decision => ({
  verdict,
  decisive_clause_ids: ids,
  reason: "Model reason.",
  conditions: [],
  missing: [],
  confidence: "high",
  rules_applied: [],
  ...over,
});

function run(over: Partial<CeilingInput> & { action?: Action }) {
  return applyCeilings({ action: "crawl", signals: signals(), blocked: [], clauses: [], decision: decision("GO"), decider: "ok", ...over }, texts);
}

describe("strictest", () => {
  it("orders NO_GO < ASK < GO", () => {
    expect(strictest("GO", "ASK")).toBe("ASK");
    expect(strictest("ASK", "NO_GO", "GO")).toBe("NO_GO");
    expect(strictest("GO")).toBe("GO");
  });
});

describe("applyCeilings", () => {
  it("keeps a valid GO when nothing applies", () => {
    const o = run({});
    expect(o).toMatchObject({ final: "GO", serv_verdict: "GO", ceilings: [], flags: [] });
  });

  it("S1: robots disallow makes crawl NO_GO and read_page at most ASK, and leaves other actions alone", () => {
    const s = signals({}, { disallow_for_agent: true });
    const crawl = run({ signals: s });
    expect(crawl).toMatchObject({ final: "NO_GO", ceilings: ["S1"], reason: texts.reason_robots });
    expect(run({ signals: s, action: "read_page" })).toMatchObject({ final: "ASK", ceilings: ["S1"] });
    expect(run({ signals: s, action: "purchase" })).toMatchObject({ final: "GO", ceilings: [] });
  });

  it("S2: ai-train=no makes train NO_GO", () => {
    const o = run({ action: "train", signals: signals({}, { content_signal: { "ai-train": "no" } }) });
    expect(o).toMatchObject({ final: "NO_GO", ceilings: ["S2"], reason: texts.reason_ai_train });
  });

  it("S3: ai-input=no caps read_page at ASK and states the condition", () => {
    const o = run({ action: "read_page", signals: signals({}, { content_signal: { "ai-input": "no" } }) });
    expect(o).toMatchObject({ final: "ASK", ceilings: ["S3"] });
    expect(o.conditions).toContain(texts.ai_input_no);
  });

  it("S4: a blocked page caps every action at ASK and names the URL and status", () => {
    const o = run({ action: "post", blocked: [{ url: "https://shop.example/terms", status: 403 }] });
    expect(o).toMatchObject({ final: "ASK", ceilings: ["S4"] });
    expect(o.missing).toContain("https://shop.example/terms (HTTP 403)");
  });

  it("S5: nothing read, or something not read in full, caps at ASK", () => {
    const none = run({ signals: signals({ docs_read: 0 }) });
    expect(none).toMatchObject({ final: "ASK", ceilings: ["S5"] });
    expect(none.missing).toContain(texts.nothing_read);
    const part = run({ signals: signals({ unreadable: [{ url: "https://shop.example/aup", why: "needs_browser" }] }) });
    expect(part).toMatchObject({ final: "ASK", ceilings: ["S5"] });
    expect(part.missing).toContain("https://shop.example/aup (needs_browser)");
  });

  it("S6: GO against a verified prohibition becomes ASK with a flag", () => {
    const o = run({ clauses: [clause("c1", "prohibits")], decision: decision("GO") });
    expect(o).toMatchObject({ final: "ASK", ceilings: ["S6"], flags: ["model_disagrees_with_evidence"] });
  });

  it("S7: NO_GO without a cited prohibition or a signal becomes ASK; with one it stands", () => {
    const bare = run({ clauses: [clause("c1", "restricts")], decision: decision("NO_GO", ["c1"]) });
    expect(bare).toMatchObject({ final: "ASK", serv_verdict: "NO_GO", ceilings: ["S7"], flags: ["unsupported_no_go"] });
    const cited = run({ clauses: [clause("c1", "prohibits")], decision: decision("NO_GO", ["c1"]) });
    expect(cited).toMatchObject({ final: "NO_GO", ceilings: [] });
    const signal = run({ signals: signals({}, { disallow_for_agent: true }), decision: decision("NO_GO") });
    expect(signal).toMatchObject({ final: "NO_GO", ceilings: ["S1"] });
  });

  it("S8: decider failure, guard refusal or a cited id that was not sent all end in ASK", () => {
    expect(run({ decision: null, decider: "unavailable" })).toMatchObject({ final: "ASK", serv_verdict: null, ceilings: ["S8"], flags: ["decider_unavailable"], reason: texts.reason_decider_unavailable });
    expect(run({ decision: null, decider: "guard_tripped" })).toMatchObject({ final: "ASK", ceilings: ["S8"], flags: ["guard_tripped"], reason: texts.reason_guard_tripped });
    const bad = run({ clauses: [clause("c1", "permits")], decision: decision("GO", ["c1", "c9"]) });
    expect(bad).toMatchObject({ final: "ASK", ceilings: ["S8"], flags: ["bad_citation"], decisive_clause_ids: ["c1"] });
  });

  it("S9: text addressed to AI keeps a NO_GO, lowers confidence and is flagged", () => {
    const o = run({ signals: signals({ addressed_to_ai_found: true }), clauses: [clause("c1", "prohibits")], decision: decision("NO_GO", ["c1"]) });
    expect(o).toMatchObject({ final: "NO_GO", confidence: "low", ceilings: ["S9"], flags: ["addressed_to_ai"] });
    expect(o.conditions).not.toContain(texts.ai_text_found);
  });

  it("S9: text addressed to AI caps a GO at ASK, with the named flag and a condition", () => {
    const o = run({ action: "read_page", signals: signals({ addressed_to_ai_found: true }), clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) });
    expect(o).toMatchObject({ final: "ASK", serv_verdict: "GO", confidence: "low", ceilings: ["S9"], flags: ["addressed_to_ai"] });
    expect(o.conditions).toContain(texts.ai_text_found);
  });

  it("S10: a crawl where robots.txt sets a Crawl-delay is ASK with a wait condition", () => {
    const o = run({ signals: signals({}, { crawl_delay: 2 }), clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) });
    expect(o).toMatchObject({ final: "ASK", serv_verdict: "GO", ceilings: ["S10"], flags: [] });
    expect(o.conditions).toContain(texts.crawl_delay_wait.replace("{seconds}", "2"));
    expect(texts.crawl_delay_wait).toContain("{seconds}");
  });

  it("S10 only applies to crawl, and not without a positive Crawl-delay", () => {
    for (const action of ["read_page", "train", "account", "purchase", "post"] as Action[]) {
      expect(run({ action, signals: signals({}, { crawl_delay: 5 }), clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) }).final).toBe("GO");
    }
    expect(run({ signals: signals({}, { crawl_delay: null }), clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) }).final).toBe("GO");
    expect(run({ signals: signals({}, { crawl_delay: 0 }), clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) }).final).toBe("GO");
  });

  it("S9 and S10 never raise a verdict: every decided verdict ends at or below where it started", () => {
    const sigs = [signals({ addressed_to_ai_found: true }), signals({}, { crawl_delay: 3 }), signals({ addressed_to_ai_found: true }, { crawl_delay: 3 })];
    for (const action of ["read_page", "crawl", "train", "account", "purchase", "post"] as Action[]) {
      for (const sig of sigs) {
        for (const v of ["GO", "ASK", "NO_GO"] as Verdict[]) {
          const plain = run({ action, clauses: [clause("c1", "prohibits")], decision: decision(v, ["c1"]) }).final;
          const capped = run({ action, signals: sig, clauses: [clause("c1", "prohibits")], decision: decision(v, ["c1"]) }).final;
          expect(strictest(plain, capped)).toBe(capped);
        }
        for (const cap of signalCeilings(action, sig)) expect(cap.cap).toBe("ASK");
      }
    }
  });

  it("R6: an ASK citing a general ban and a specific permission stands (code only caps, never raises)", () => {
    const clauses = [clause("c1", "prohibits"), clause("c2", "permits", "api_required")];
    const o = run({ clauses, decision: decision("ASK", ["c1", "c2"], { conditions: ["use the public API"] }) });
    expect(o).toMatchObject({ final: "ASK", serv_verdict: "ASK", ceilings: [], flags: [] });
    expect(o.conditions).toEqual(["use the public API"]);
  });

  it("a skipped decision (nothing read) is ASK at best and says why", () => {
    const o = run({ signals: signals({ docs_read: 0, docs: [] }), decision: null, decider: "skipped" });
    expect(o).toMatchObject({ final: "ASK", flags: ["decider_skipped"], ceilings: ["S5"], reason: texts.reason_decider_skipped });
  });

  it("never returns GO without a valid GO from the decider, whatever else is true", () => {
    const actions: Action[] = ["read_page", "crawl", "train", "account", "purchase", "post"];
    for (const action of actions) {
      for (const d of [null, decision("ASK"), decision("NO_GO")]) {
        for (const decider of ["unavailable", "guard_tripped", "skipped", "ok"] as const) {
          if ((d === null) !== (decider !== "ok")) continue;
          expect(run({ action, decision: d, decider }).final).not.toBe("GO");
        }
      }
    }
  });
});
