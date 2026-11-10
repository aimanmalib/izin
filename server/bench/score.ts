// Scoring for the benchmark: agreement with the pre-registered answer, false GO and false NO_GO,
// the median, and the K6 rule that picks the variant to ship. Pure functions, no I/O.
import type { Verdict } from "../config.js";

export interface ScoredPair {
  expected: Verdict;
  /** Other verdicts the label also allows (Set B only; never wider than the rule). */
  acceptable: readonly Verdict[];
  got: Verdict;
}

export interface Share {
  pairs: number;
  agree: number;
  false_go: number;
  false_no_go: number;
}

const ok = (p: ScoredPair): boolean => p.got === p.expected || p.acceptable.includes(p.got);

export function share(rows: readonly ScoredPair[]): Share {
  return {
    pairs: rows.length,
    agree: rows.filter(ok).length,
    false_go: rows.filter((p) => !ok(p) && p.got === "GO").length,
    false_no_go: rows.filter((p) => !ok(p) && p.got === "NO_GO").length,
  };
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface VariantScore extends Share {
  id: string;
  provider: "serv" | "dolphin";
  cost_usd_per_decision: number;
}

/**
 * K6: fewest false GO, then most agreement, then lowest cost; a tie goes to the tie variant.
 * Only SERV variants can ship: the decider must run on SERV even when the Dolphin-only line scores better.
 */
export function pickShipped(scores: readonly VariantScore[], tie: string): string {
  const serv = scores.filter((s) => s.provider === "serv");
  if (!serv.length) throw new Error("no SERV variant to ship");
  const key = (s: VariantScore) => [s.false_go, -s.agree, s.cost_usd_per_decision] as const;
  const cmp = (a: VariantScore, b: VariantScore) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  };
  const best = [...serv].sort(cmp)[0]!;
  const tied = serv.filter((s) => cmp(s, best) === 0);
  return tied.some((s) => s.id === tie) ? tie : best.id;
}
