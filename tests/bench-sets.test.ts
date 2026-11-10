// The pre-registered benchmark sets: shape, coverage, and that every synthetic case builds a site the
// collector reads the way the case intends. No model, no outside network.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VERDICTS } from "../server/config.js";
import { collect } from "../server/kumpul/collect.js";
import { loadSets, syntheticSite, type LabeledCase } from "../server/bench/sets.js";
import { startSites, testConfig, type Running, type Sites } from "./helpers/sites.js";

const sets = loadSets();
const cfg = testConfig();
const rank = (v: string) => (VERDICTS as readonly string[]).indexOf(v); // NO_GO 0, ASK 1, GO 2
const pairKey = (p: { site: string; action: string }) => `${p.site} ${p.action}`;
const dnf = new Set(cfg.do_not_fetch_hosts.map((h) => h.toLowerCase()));
const onDnf = (site: string) => [...dnf].some((d) => site === d || site.endsWith(`.${d}`));

describe("Set A (bench/manual.json)", () => {
  const a = sets.manual;

  it("has at least 12 distinct pairs decided by the 5 Nov review, and the mapping covers every verdict", () => {
    expect(a.pairs.length).toBeGreaterThanOrEqual(12);
    expect(new Set(a.pairs.map(pairKey)).size).toBe(a.pairs.length);
    expect(new Set(a.pairs.map((p) => p.decided_on))).toEqual(new Set(["2026-11-05"]));
    expect(new Set(a.mapping.map((m) => m.verdict))).toEqual(new Set(VERDICTS));
    expect(a.label).toContain("run by a coding agent");
  });

  it("never plans a fetch of a do-not-fetch host, and fetches every other host once", () => {
    for (const p of a.pairs) {
      const host = new URL(p.url).hostname;
      if (onDnf(p.site) || onDnf(host)) expect(p.mode, p.site).not.toBe("fetch_once");
      else expect(p.mode, p.site).toBe("fetch_once");
      for (const h of p.policy_hints) expect(onDnf(new URL(h).hostname), h).toBe(false);
      expect(Object.keys(a.modes)).toContain(p.mode);
    }
  });

  it("pastes a recorded quote in paste mode, and every quote carries its URL", () => {
    for (const p of a.pairs) {
      if (p.mode === "paste_recorded") expect(p.quote?.length ?? 0, p.site).toBeGreaterThanOrEqual(cfg.limits.quote_min_chars);
      if (p.quote) expect(p.quote_url, p.site).not.toBeNull();
    }
  });
});

describe("Set B (bench/labeled.json)", () => {
  const b = sets.labeled;

  it("has 20 cases with distinct ids covering R1 to R10 and the named signals", () => {
    expect(new Set(b.cases.map((c) => c.id)).size).toBe(20);
    const tags = new Set(b.cases.flatMap((c) => c.tests));
    for (let r = 1; r <= 10; r++) expect(tags, `R${r}`).toContain(`R${r}`);
    for (const t of ["robots_comments", "ai_input_no", "injection", "hidden_text"]) expect(tags, t).toContain(t);
    // R8 silence both ways: GO for an ordinary action, ASK for training.
    const silent = b.cases.filter((c) => c.tests.includes("R8"));
    expect(silent.some((c) => c.action === "train" && c.expected === "ASK")).toBe(true);
    expect(silent.some((c) => c.action !== "train" && c.expected === "GO")).toBe(true);
  });

  it("only ever accepts a stricter verdict than the expected one, so a GO is never excused", () => {
    for (const c of b.cases) {
      expect(c.also_acceptable, c.id).not.toContain(c.expected);
      for (const v of c.also_acceptable) expect(rank(v), c.id).toBeLessThan(rank(c.expected));
    }
  });

  it("states owner review honestly in the label", () => {
    expect(b.label).toContain(`owner review: ${b.owner_review ? "yes" : "no"}`);
  });
});

describe("spot checks (bench/spot.json)", () => {
  it("has at most 10 distinct pairs, all on gallery sites", () => {
    const gallery = JSON.parse(readFileSync(new URL("../config/gallery.json", import.meta.url), "utf8")) as { sites: { host: string }[] };
    const hosts = new Set(gallery.sites.map((s) => s.host));
    const s = sets.spot;
    expect(s.pairs.length).toBeLessThanOrEqual(10);
    expect(new Set(s.pairs.map(pairKey)).size).toBe(s.pairs.length);
    for (const p of s.pairs) expect(hosts, p.site).toContain(p.site);
    expect(s.read_with).toContain(cfg.user_agent);
  });
});

describe("synthetic sites", () => {
  let run: Running | null = null;
  afterEach(async () => {
    await run?.close();
    run = null;
  });

  const site = (c: LabeledCase) => syntheticSite(sets.labeled, c);
  async function collectCase(c: LabeledCase) {
    const s = site(c);
    run = await startSites({ [s.host]: s.routes } as Sites);
    return collect({ url: run.url(s.host, "/"), action: c.action }, { cfg, policy: run.policy });
  }
  const has = (c: LabeledCase, tag: string) => c.tests.includes(tag);

  it.each(sets.labeled.cases.map((c) => [c.id, c] as const))("%s is read as the case intends", async (_id, c) => {
    const out = await collectCase(c);
    const text = out.docs.map((d) => d.text).join("\n");
    if (has(c, "ai_input_no")) {
      expect(out.signals.ai_input_no).toBe(true);
      expect(out.docs.filter((d) => d.to_model)).toHaveLength(0);
    } else if (has(c, "robots_disallow") || has(c, "robots_comments")) {
      expect(out.signals.robots_stop).not.toBeNull();
      expect(out.requests_used).toBe(1);
    } else if (c.terms_status !== 200) {
      expect(out.signals.unreadable.length + out.signals.blocked.length).toBeGreaterThan(0);
    } else {
      expect(out.signals.docs_read, c.id).toBeGreaterThanOrEqual(1);
      expect(out.signals.unreadable).toHaveLength(0);
      for (const clause of c.terms ?? []) expect(text).toContain(clause);
      for (const clause of c.hidden) expect(text).toContain(clause);
    }
  });

  it("puts the reader-addressed sentences where the injection filter sees them", () => {
    const patterns = cfg.injection_patterns.map((p) => new RegExp(p, "iu"));
    for (const c of sets.labeled.cases.filter((x) => has(x, "injection"))) {
      const lines = [...(c.terms ?? []), ...c.hidden];
      expect(lines.some((l) => patterns.some((p) => p.test(l))), c.id).toBe(true);
    }
  });
});
