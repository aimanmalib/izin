// Comparing a stored reading with a fresh one: quotes are compared character for character.
import { describe, expect, it } from "vitest";
import { compareReadings, summarise } from "../server/baca/reread.js";
import type { ReaderOutput } from "../server/baca/types.js";

const out = (...quotes: string[]): ReaderOutput =>
  ({ clauses: quotes.map((quote) => ({ quote, section: "", category: "automated_access", stance: "prohibits" })), addressed_to_ai: [], last_updated: null }) as unknown as ReaderOutput;

describe("compareReadings", () => {
  it("calls two readings identical only when the quote sets match", () => {
    expect(compareReadings("https://a.example/terms", 100, out("a", "b"), out("b", "a"))).toMatchObject({ stored_clauses: 2, fresh_clauses: 2, same_quotes: 2, identical: true });
    expect(compareReadings("https://a.example/terms", 100, out("a", "b"), out("a"))).toMatchObject({ same_quotes: 1, identical: false });
    expect(compareReadings("https://a.example/terms", 100, out("a"), out("a", "c"))).toMatchObject({ same_quotes: 1, identical: false });
    expect(compareReadings("https://a.example/terms", 100, out(), out())).toMatchObject({ same_quotes: 0, identical: true });
  });

  it("sums documents and quotes", () => {
    const rows = [compareReadings("u1", 1, out("a", "b"), out("a", "b")), compareReadings("u2", 1, out("a", "b"), out("a"))];
    expect(summarise(rows)).toEqual({ documents: 2, identical: 1, stored_quotes: 4, same_quotes: 3 });
  });
});
