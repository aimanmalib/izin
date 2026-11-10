import { describe, expect, it } from "vitest";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import { loadConfig } from "../server/config.js";

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

  it("does not carry labels for things the config does not define", () => {
    const groups = { actions: config.actions, categories: config.categories, stances: config.stances } as const;
    for (const [group, ids] of Object.entries(groups)) {
      const keys = [...EN.keys()].filter((k) => k.startsWith(`${group}.`)).map((k) => k.slice(group.length + 1));
      expect(keys.sort()).toEqual([...ids].sort());
    }
  });
});
