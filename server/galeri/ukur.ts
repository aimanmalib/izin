// Writes generated sections of docs/UKUR.md. Each section sits between two marker comments and is
// replaced whole on every run, so the numbers in the file always come from the latest data.
import type { Action } from "../config.js";
import { decidedBy, type BaselineCounts } from "./baseline.js";
import type { GalleryCell } from "../api/views.js";
import type { ReadingCost } from "../belanja/kos.js";

export interface GallerySlice {
  sites: { host: string; checks: Partial<Record<Action, GalleryCell>> }[];
  baseline: BaselineCounts;
}

const start = (name: string) => `<!-- izin:${name}:start -->`;
const end = (name: string) => `<!-- izin:${name}:end -->`;

/** Replaces the named section (markers included) or appends it when the file has none yet. */
export function replaceSection(doc: string, name: string, body: string, after?: string): string {
  const block = `${start(name)}\n${body.trim()}\n${end(name)}`;
  const a = doc.indexOf(start(name));
  const b = doc.indexOf(end(name));
  if (a >= 0 && b > a) return doc.slice(0, a) + block + doc.slice(b + end(name).length);
  // A new section goes right after the named one when it exists, else at the end.
  const at = after ? doc.indexOf(end(after)) : -1;
  if (at >= 0) {
    const cut = at + end(after!).length;
    return `${doc.slice(0, cut)}\n\n${block}${doc.slice(cut)}`;
  }
  return `${doc.trimEnd()}\n\n${block}\n`;
}

/** The "Robots-only baseline" section, from the gallery view. Every number is counted here. */
export function baselineSection(g: GallerySlice, origin: string, at: string): string {
  const b = g.baseline;
  const lines = [
    "## Robots-only baseline",
    "",
    `Generated ${at} from the gallery receipts. Definition: [ADR 0010](decisions/0010-robots-only-baseline.md).`,
    "",
  ];
  if (!b.pairs) return [...lines, "No gallery pair has a receipt yet."].join("\n");
  lines.push(
    `Gallery pairs with a receipt: ${b.pairs}. A robots.txt parser alone (IzinBot, \`*\` and the agent token) answers allowed for ${b.allowed}, disallowed for ${b.disallowed}, and has no robots.txt to read for ${b.no_robots}.`,
    "",
    `Pairs where robots.txt allows the URL but a quoted clause from the site (a robots.txt comment or the terms) restricts or forbids the action, and Izin answered ASK or NO-GO on that clause: **${b.robots_allowed_words_restrict} of ${b.allowed}**.`,
    "",
    "An ASK that comes only from a block, an unreadable page, an unavailable decision step, or a code ceiling that lowered the decision step's GO is not counted.",
    "",
    `Pairs the decision step answered with a valid decision: **${b.decided}** of ${b.pairs}. robots.txt allows the URL in ${b.decided_allowed} of them, and in **${b.decided_allowed_words_restrict} of ${b.decided_allowed}** a quoted clause restricts or forbids the action. The gallery shows a pair with no valid decision as not decided.`,
  );
  const counted = g.sites.flatMap((s) =>
    Object.entries(s.checks)
      .filter(([, c]) => c?.words_restrict)
      .map(([action, c]) => `- ${s.host}, ${action}: ${c!.verdict ?? "?"}, [receipt](${origin.replace(/\/$/, "")}/r/${c!.receipt_id})`),
  );
  if (counted.length) lines.push("", "Counted pairs:", "", ...counted);
  return lines.join("\n");
}

const usd = (n: number) => n.toFixed(n > 0 && n < 0.01 ? 6 : 4);
const count = (n: number) => n.toLocaleString("en-US");

/** The "Reading cost" section: Dolphin tokens and cost from the ledger, the same tokens at a listed SERV price. */
export function readingCostSection(c: ReadingCost | null, at: string): string {
  const lines = ["## Reading cost", "", `Generated ${at} from the reader ledger. Definition: [ADR 0011](decisions/0011-reading-cost-line.md).`, ""];
  if (!c) return [...lines, "No reading on Dolphin is in the ledger yet."].join("\n");
  lines.push(
    `Tokens read on Dolphin: ${count(c.tokens)} (${count(c.tokens_in)} in, ${count(c.tokens_out)} out) over ${c.readings} stored ${c.readings === 1 ? "reading" : "readings"}.`,
    "",
    `Cost of those readings on Dolphin: USD ${usd(c.cost_usd)}.`,
    "",
    `The same tokens at the listed price of \`${c.list.model}\` (USD ${c.list.input_usd_per_mtok} in, USD ${c.list.output_usd_per_mtok} out per million tokens): USD ${usd(c.list.cost_usd)}.`,
    "",
    `Price sources: [SERV](${c.price_sources.serv}), [Dolphin](${c.price_sources.dolphin}).`,
  );
  return lines.join("\n");
}

/** One gallery cell as stored now: the verdict, the receipt's day, and how the decision was made. */
export interface GalleryNowRow {
  verdict: string | null;
  created_at: string;
  serv_verdict: string | null;
  ceilings: string[];
  flags: string[];
  model: string | null;
}

type DayCount = { receipts: number; GO: number; ASK: number; NO_GO: number; answered: number; by_code: number; no_answer: number; models: Record<string, number> };

/** Counts the current gallery cells by verdict and by how they were decided, per UTC day of the receipt. */
export function galleryNowCounts(rows: GalleryNowRow[]) {
  const blank = (): DayCount => ({ receipts: 0, GO: 0, ASK: 0, NO_GO: 0, answered: 0, by_code: 0, no_answer: 0, models: {} });
  const total = blank();
  const days: Record<string, DayCount> = {};
  for (const r of rows) {
    const day = (days[r.created_at.slice(0, 10)] ??= blank());
    for (const c of [total, day]) {
      c.receipts++;
      if (r.verdict === "GO" || r.verdict === "ASK" || r.verdict === "NO_GO") c[r.verdict]++;
      const how = decidedBy(r);
      if (how === "decider") {
        c.answered++;
        if (r.model) c.models[r.model] = (c.models[r.model] ?? 0) + 1;
      } else if (how === "code") c.by_code++;
      else c.no_answer++;
    }
  }
  return { total, days: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)) };
}

/** The "Gallery now" section: the receipts the gallery shows today, which mixes several runs. */
export function galleryNowSection(rows: GalleryNowRow[], at: string): string {
  const { total: t, days } = galleryNowCounts(rows);
  const lines = ["## Gallery now", "", `Generated ${at} from the receipts the gallery shows today. Each pair shows its latest gallery receipt, so the runs below add up to one table.`, ""];
  if (!t.receipts) return [...lines, "No gallery pair has a receipt yet."].join("\n");
  lines.push(
    `Pairs with a receipt: **${t.receipts}**. GO ${t.GO}, ASK ${t.ASK}, NO-GO ${t.NO_GO}.`,
    "",
    `The decision step gave a valid answer on **${t.answered}** of them. On ${t.by_code} the code decided without calling it (no clause to weigh, or nothing readable), and those stay at ASK. On ${t.no_answer} no valid decision came back (ceiling S8: no answer, or an answer citing a clause that is not in the text).`,
    "",
    "| Receipt day (UTC) | Receipts | GO | ASK | NO-GO | Decision step answered | Decided by code | No valid decision | Decider model |",
    "|---|---|---|---|---|---|---|---|---|",
    ...days.map(([d, c]) => {
      const models = Object.entries(c.models).map(([m, n]) => `\`${m}\` (${n})`).join(", ") || "none";
      return `| ${d} | ${c.receipts} | ${c.GO} | ${c.ASK} | ${c.NO_GO} | ${c.answered} | ${c.by_code} | ${c.no_answer} | ${models} |`;
    }),
  );
  return lines.join("\n");
}
