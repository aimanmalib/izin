// Runs the quote checker and the AI-text filter over every document of one check.
import type { IzinConfig } from "../config.js";
import type { CheckDoc, ReaderOutput } from "../baca/types.js";
import { compilePatterns, isQuarantined, quarantineDoc, type Quarantined } from "./quarantine.js";
import { numberClauses, verifyDocClauses, type VerifiedClause } from "./quotes.js";

export interface CheckInput {
  doc: CheckDoc;
  /** Null when the document was not read by a model (ai-input=no, reader failure). */
  output: ReaderOutput | null;
}

export interface CheckedEvidence {
  clauses: VerifiedClause[];
  quarantined: Quarantined[];
  last_updated: Record<string, string>;
  counts: {
    dropped_quotes: number;
    dropped_enum: number;
    merged_duplicates: number;
    quarantined_clauses: number;
  };
  signals: { addressed_to_ai_found: boolean };
}

export function checkEvidence(inputs: CheckInput[], cfg: IzinConfig): CheckedEvidence {
  const patterns = compilePatterns(cfg);
  const counts = { dropped_quotes: 0, dropped_enum: 0, merged_duplicates: 0, quarantined_clauses: 0 };
  const quarantined: Quarantined[] = [];
  const kept: Omit<VerifiedClause, "id">[] = [];
  const last_updated: Record<string, string> = {};

  for (const { doc, output } of inputs) {
    const q = quarantineDoc(doc, output?.addressed_to_ai ?? [], patterns, cfg);
    quarantined.push(...q);
    if (!output) continue;
    if (typeof output.last_updated === "string" && output.last_updated.trim()) last_updated[doc.id] = output.last_updated.trim().slice(0, 80);
    const v = verifyDocClauses(doc, output, cfg);
    counts.dropped_quotes += v.counts.dropped_quotes;
    counts.dropped_enum += v.counts.dropped_enum;
    for (const c of v.clauses) {
      if (isQuarantined(c, q)) counts.quarantined_clauses++;
      else kept.push(c);
    }
  }
  const { clauses, merged } = numberClauses(kept);
  counts.merged_duplicates = merged;
  return { clauses, quarantined, last_updated, counts, signals: { addressed_to_ai_found: quarantined.length > 0 } };
}

/** Assigns d1..dn in collection order. */
export function numberDocs<T extends Omit<CheckDoc, "id">>(docs: T[]): (T & { id: string })[] {
  return docs.map((d, i) => ({ ...d, id: `d${i + 1}` }));
}
