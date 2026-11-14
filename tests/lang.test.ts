import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import { EXAMPLES_PATH, loadConfig } from "../server/config.js";
import { loadExamples } from "../server/web/site.js";

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
  }
  return out;
}

const EN = leaves(en as Tree);
const MS = leaves(ms as Tree);
const config = loadConfig();

describe("lang parity", () => {
  it("has the same keys in English and Malay", () => {
    expect([...MS.keys()].sort()).toEqual([...EN.keys()].sort());
  });

  it("has no empty strings", () => {
    for (const [k, v] of [...EN, ...MS]) expect(v.trim(), k).not.toBe("");
  });

  it("labels every configured action, verdict, category and stance", () => {
    for (const t of [EN, MS]) {
      for (const a of config.actions) expect(t.has(`actions.${a}`), a).toBe(true);
      for (const v of config.verdicts) {
        expect(t.has(`verdicts.${v}.label`), v).toBe(true);
        expect(t.has(`verdicts.${v}.definition`), v).toBe(true);
      }
      for (const c of config.categories) expect(t.has(`categories.${c}`), c).toBe(true);
      for (const s of config.stances) expect(t.has(`stances.${s}`), s).toBe(true);
    }
  });

  it("labels every one-click example in config/examples.json, and only those", () => {
    const keys = loadExamples(EXAMPLES_PATH).map((e) => `web.form.example_${e.key}`);
    for (const t of [EN, MS]) {
      for (const k of keys) expect(t.has(k), k).toBe(true);
      const labels = [...t.keys()].filter((k) => /^web\.form\.example_/.test(k) && k !== "web.form.example_filled");
      expect(labels.sort()).toEqual([...keys].sort());
    }
  });

  it("does not carry labels for things the config does not define", () => {
    const groups = { actions: config.actions, categories: config.categories, stances: config.stances } as const;
    for (const [group, ids] of Object.entries(groups)) {
      const keys = [...EN.keys()].filter((k) => k.startsWith(`${group}.`)).map((k) => k.slice(group.length + 1));
      expect(keys.sort()).toEqual([...ids].sort());
    }
  });

  it("uses the same {slots} in English and Malay", () => {
    const slots = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of EN) expect(slots(MS.get(k) ?? ""), k).toEqual(slots(v));
  });

  it("keeps public web text free of exclamation marks, long dashes and absolute claims", () => {
    const banned = /[!\u2014]|\b(guarantee[sd]?|lawful|compliant|seamless|revolutionary)\b/i;
    for (const [k, v] of [...EN, ...MS]) if (k.startsWith("web.")) expect(v, k).not.toMatch(banned);
  });
});

describe("public wording", () => {
  // The 5 Nov source review was run by a coding agent; no UI text may present it as a human reading.
  const human = /\b(by people|by hand|handwritten|recorded by humans?)\b|direkod manusia|dengan tangan/i;
  it("does not describe the recorded decisions as made by people", () => {
    for (const [k, v] of [...EN, ...MS]) expect(human.test(v), `${k}: ${v}`).toBe(false);
  });

  it("keeps the README, measurements and decision records free of the same wording", () => {
    const adrs = readdirSync("docs/decisions").filter((f) => f.endsWith(".md")).map((f) => `docs/decisions/${f}`);
    for (const file of ["README.md", "docs/UKUR.md", ...adrs]) {
      const hits = readFileSync(file, "utf8").split("\n").filter((line) => human.test(line));
      expect(hits, file).toEqual([]);
    }
  });

  it("splits the shipped decider's false GO by benchmark set in the README", () => {
    const readme = readFileSync("README.md", "utf8");
    const split = /False GO for the shipped decider(?: in (?:that|the) run)?: \d+ of \d+ designed cases, \d+ of \d+\s+spot\s+checks, \d+ of \d+\s+recorded decisions/g;
    expect(readme.match(split)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(readme).not.toMatch(/gave \d+ false GO/);
  });
});
