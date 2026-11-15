// Code ceilings S1 to S11: each one, the R6 case, and failures that must never end in GO.
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
  // One permitting clause quoted from the policy document by default, so S11 stays out of the other cases.
  return applyCeilings({ action: "crawl", signals: signals(), blocked: [], clauses: [clause("c0", "permits")], decision: decision("GO"), decider: "ok", ...over }, texts);
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
    expect(part.missing).toContain(`https://shop.example/aup (${texts.unreadable_why.needs_browser})`);
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
        for (const cap of signalCeilings(action, sig, [])) expect(cap.cap).toBe("ASK");
      }
    }
  });

  it("S11: a GO for crawl, account, purchase or post with no clause quoted from a policy document is ASK, and says what was read", () => {
    // Shape of a large retailer: a 13k-character terms page was read, and no clause could be quoted from it.
    const s = signals({ docs: [{ id: "d1", url: "https://shop.example/terms", kind: "policy", chars: 13204, truncated: false }] });
    for (const action of ["crawl", "account", "purchase", "post"] as Action[]) {
      const o = run({ action, signals: s, clauses: [], decision: decision("GO") });
      expect(o).toMatchObject({ final: "ASK", serv_verdict: "GO", ceilings: ["S11"] });
      expect(o.reason).toContain("https://shop.example/terms (13,204 characters)");
      expect(o.reason).toBe(texts.reason_no_policy_clause.replace("{read}", "https://shop.example/terms (13,204 characters)"));
    }
    // A clause from robots.txt comments alone is not a clause from the terms.
    const robotsOnly = signals({ docs: [{ id: "r1", url: "https://shop.example/robots.txt", kind: "robots_comments", chars: 300, truncated: false }] });
    const viaRobots = run({ signals: robotsOnly, clauses: [{ ...clause("c1", "permits"), doc: "r1" }], decision: decision("GO", ["c1"]) });
    expect(viaRobots).toMatchObject({ final: "ASK", ceilings: ["S11"] });
    // Terms the caller pasted count as the site's terms.
    const pasted = signals({ docs: [{ id: "p1", url: "https://shop.example/", kind: "pasted", chars: 900, truncated: false }] });
    expect(run({ signals: pasted, clauses: [{ ...clause("c1", "permits"), doc: "p1" }], decision: decision("GO", ["c1"]) }).final).toBe("GO");
  });

  it("S11 leaves read_page and train alone, and keeps a GO that quotes a policy clause", () => {
    for (const action of ["read_page", "train"] as Action[]) {
      expect(run({ action, clauses: [], decision: decision("GO") })).toMatchObject({ final: "GO", ceilings: [] });
    }
    expect(run({ action: "post", clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) })).toMatchObject({ final: "GO", ceilings: [] });
  });

  it("S11 never raises: an ASK or NO_GO keeps its verdict and its reason", () => {
    const s = signals();
    const ask = run({ action: "post", signals: s, clauses: [], decision: decision("ASK") });
    expect(ask).toMatchObject({ final: "ASK", serv_verdict: "ASK", reason: "Model reason." });
    const no = run({ action: "crawl", signals: signals({}, { disallow_for_agent: true }), clauses: [], decision: decision("NO_GO") });
    expect(no.final).toBe("NO_GO");
    for (const v of ["GO", "ASK", "NO_GO"] as Verdict[]) {
      const capped = run({ action: "purchase", clauses: [], decision: decision(v) }).final;
      expect(capped).not.toBe("GO");
    }
  });

  it("S11 with no clause at all and the decision skipped: ASK, and the reason names what was read", () => {
    const o = run({ action: "account", clauses: [], decision: null, decider: "skipped" });
    expect(o).toMatchObject({ final: "ASK", flags: ["decider_skipped"], ceilings: ["S11"] });
    expect(o.reason).toContain("https://shop.example/terms (2,000 characters)");
  });

  it("S11 names each URL once: six robots.txt comment blocks of one file are one entry with their total size", () => {
    // Shape of /r/5pppwplbgz: robots.txt read as six comment blocks, the terms page needs a browser.
    const sizes = [208, 290, 227, 232, 212, 241];
    const docs = sizes.map((chars, i) => ({ id: `d${i + 1}`, url: "https://shop.example/robots.txt", kind: "robots_comments" as const, chars, truncated: false }));
    const s = signals({ docs_read: 6, docs, unreadable: [{ url: "https://shop.example/terms", why: "needs_browser" }] });
    const o = run({ action: "purchase", signals: s, clauses: [], decision: null, decider: "skipped" });
    expect(o.reason.split("https://shop.example/robots.txt").length - 1).toBe(1);
    expect(o.reason).toBe(texts.reason_no_terms_read.replace("{read}", `https://shop.example/robots.txt (1,410 characters, ${texts.read_robots_comments})`));
    expect(o.reason).toContain("could not read the site's terms");
  });

  it("S11 with terms read says no clause from the site's terms, even when robots.txt comments were read too", () => {
    const s = signals({
      docs_read: 2,
      docs: [
        { id: "d1", url: "https://shop.example/terms", kind: "policy", chars: 900, truncated: false },
        { id: "d2", url: "https://shop.example/robots.txt", kind: "robots_comments", chars: 100, truncated: false },
      ],
    });
    const o = run({ action: "post", signals: s, clauses: [], decision: decision("GO") });
    expect(o.reason).toBe(texts.reason_no_policy_clause.replace("{read}", `https://shop.example/terms (900 characters), https://shop.example/robots.txt (100 characters, ${texts.read_robots_comments})`));
    expect(o.reason).toContain("from the site's terms");
  });

  it("a read_page GO with no clause from a policy document carries a reason written by code, and stays GO", () => {
    const robots = signals({ docs: [{ id: "r1", url: "https://shop.example/robots.txt", kind: "robots_comments", chars: 300, truncated: false }] });
    const o = run({ action: "read_page", signals: robots, clauses: [], decision: decision("GO", [], { reason: "The terms were read in full." }) });
    expect(o).toMatchObject({ final: "GO", ceilings: [], reason: texts.reason_read_page_no_clause });
    const quoted = run({ action: "read_page", clauses: [clause("c1", "permits")], decision: decision("GO", ["c1"]) });
    expect(quoted).toMatchObject({ final: "GO", reason: "Model reason." });
  });

  it("missing has one line per URL: a page that answered 403 and was not read is one line", () => {
    const url = "https://shop.example/help/terms-of-service/";
    const s = signals({ docs_read: 0, docs: [], unreadable: [{ url, why: "blocked" }] });
    const o = run({ action: "crawl", signals: s, blocked: [{ url, status: 403 }], clauses: [], decision: null, decider: "skipped" });
    expect(o.missing.filter((m) => m.startsWith(url))).toEqual([`${url} (HTTP 403, ${texts.unreadable_why.blocked})`]);
    expect(o.missing).toContain(texts.nothing_read);
  });

  it("R6: an ASK citing a general ban and a specific permission stands (code only caps, never raises)", () => {
    const clauses = [clause("c1", "prohibits"), clause("c2", "permits", "api_required")];
    const o = run({ clauses, decision: decision("ASK", ["c1", "c2"], { conditions: ["use the public API"] }) });
    expect(o).toMatchObject({ final: "ASK", serv_verdict: "ASK", ceilings: [], flags: [] });
    expect(o.conditions).toEqual(["use the public API"]);
  });

  it("a skipped decision (nothing read) is ASK at best and says why", () => {
    const o = run({ signals: signals({ docs_read: 0, docs: [] }), decision: null, decider: "skipped" });
    expect(o).toMatchObject({ final: "ASK", flags: ["decider_skipped"], ceilings: ["S5", "S11"], reason: texts.reason_decider_skipped });
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
