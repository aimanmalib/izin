// Shapes shared by the reader (model output) and the quote checker.
import type { DocKind } from "../kumpul/types.js";

/** One clause as the model returned it. Fields are unchecked until the quote checker runs. */
export interface RawClause {
  quote: unknown;
  section: unknown;
  category: unknown;
  stance: unknown;
}

export interface ReaderOutput {
  clauses: RawClause[];
  addressed_to_ai: unknown[];
  last_updated: string | null;
}

/** A document as the checker sees it: id assigned, text exactly as collected. */
export interface CheckDoc {
  id: string;
  kind: DocKind;
  url: string;
  text: string;
}
