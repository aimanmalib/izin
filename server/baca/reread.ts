// Compares two readings of the same document: the stored one and a fresh one by the same model and
// prompt. Open weights make the reading step repeatable by anyone; this says how repeatable it was.
import type { ReaderOutput } from "./types.js";

export interface RereadRow {
  url: string;
  chars: number;
  stored_clauses: number;
  fresh_clauses: number;
  /** Quotes present in both readings, compared character for character. */
  same_quotes: number;
  identical: boolean;
}

const quotes = (o: ReaderOutput) => new Set(o.clauses.map((c) => c.quote));

export function compareReadings(url: string, chars: number, stored: ReaderOutput, fresh: ReaderOutput): RereadRow {
  const a = quotes(stored);
  const b = quotes(fresh);
  const same = [...a].filter((q) => b.has(q)).length;
  return { url, chars, stored_clauses: a.size, fresh_clauses: b.size, same_quotes: same, identical: a.size === b.size && same === a.size };
}

export function summarise(rows: RereadRow[]) {
  const stored = rows.reduce((s, r) => s + r.stored_clauses, 0);
  const same = rows.reduce((s, r) => s + r.same_quotes, 0);
  return { documents: rows.length, identical: rows.filter((r) => r.identical).length, stored_quotes: stored, same_quotes: same };
}
