// Re-measure of saved answers with the current code ceilings: synthetic pairs, no network, no model.
import { describe, expect, it } from "vitest";
import { remeasure, type SavedPair } from "../server/bench/score.js";

const pair = (id: string, set: SavedPair["set"], expected: SavedPair["expected"], final: SavedPair["final"], extra: SavedPair["extra"] = [], acceptable: SavedPair["acceptable"] = []): SavedPair => ({
  id,
  set,
  expected,
  acceptable,
  final,
  extra,
});

describe("remeasure", () => {
  it("lowers a saved GO to ASK under an extra cap and rescores it", () => {
    const r = remeasure([
      pair("X1", "A", "ASK", "GO", [{ code: "S10", cap: "ASK" }]),
      pair("X2", "B", "ASK", "GO", [{ code: "S9", cap: "ASK" }]),
      pair("X3", "B", "GO", "GO"),
      pair("X4", "spot", "NO_GO", "NO_GO", [{ code: "S9", cap: "ASK" }]),
    ]);
    expect(r.before).toEqual({ pairs: 4, agree: 2, false_go: 2, false_no_go: 0 });
    expect(r.after).toEqual({ pairs: 4, agree: 4, false_go: 0, false_no_go: 0 });
    expect(r.by_set.B).toEqual({ pairs: 2, agree: 2, false_go: 0, false_no_go: 0 });
    expect(r.changed).toEqual([
      { id: "X1", before: "GO", after: "ASK", ceilings: ["S10"], expected: ["ASK"] },
      { id: "X2", before: "GO", after: "ASK", ceilings: ["S9"], expected: ["ASK"] },
    ]);
  });

  it("never raises a saved verdict and can turn a right GO into ASK (counted, not hidden)", () => {
    const r = remeasure([pair("Y1", "B", "GO", "GO", [{ code: "S9", cap: "ASK" }]), pair("Y2", "B", "NO_GO", "NO_GO", [{ code: "S10", cap: "ASK" }])]);
    expect(r.changed.map((c) => [c.id, c.after])).toEqual([["Y1", "ASK"]]);
    expect(r.after).toEqual({ pairs: 2, agree: 1, false_go: 0, false_no_go: 0 });
  });
});
