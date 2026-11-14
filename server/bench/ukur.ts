// Generated sections of docs/UKUR.md for the benchmark, the gallery run, H1 and the reader. Every
// number is read from the run files (bench/results.json, bench/runs/*.json); nothing is typed in.
import type { BenchResults } from "../api/views.js";
import type { ReaderStats } from "./stats.js";
import type { Share } from "./score.js";
import type { ManualSet } from "./sets.js";
import type { Variant } from "./variants.js";

export interface BenchReportFile {
  run_at: string;
  stopped: boolean;
  shipped: string;
  variants: Variant[];
  by_set: Record<string, Record<"A" | "B" | "spot", Share>>;
  failures: Record<string, number>;
  rows: Record<string, Record<string, { final: string; serv: string | null; failure: string | null; ceilings: string[] }>>;
  reader: ReaderStats;
  /** Variant id -> when it ran, when the report joins runs on the same frozen evidence. */
  runs?: Record<string, string>;
}

export interface GalleryRunFile {
  run_at: string;
  user_agent: string;
  sites: number;
  stopped: boolean;
  checks: { site: string; action: string; receipt_id: string | null; verdict: string | null; ms_total: number; error: string | null }[];
  reader: ReaderStats;
  spend: { serv_usd: number; dolphin_usd: number };
}

export interface H1File {
  run_at: string;
  action: string;
  max_ms: number;
  pass: boolean;
  rows: { site: string; receipt_id: string | null; verdict: string | null; docs_read: number; ms: number; error: string | null }[];
  reader: ReaderStats;
}

/** What each code ceiling means, for the one-line explanation of a mismatch. */
const CEILING: Record<string, string> = {
  S1: "robots.txt disallows the URL",
  S2: "a Content Signal says ai-train=no",
  S3: "a Content Signal restricts AI input",
  S4: "a page blocked the reader",
  S5: "a document was not read in full, or nothing was read",
  S6: "the decision cited no clause or signal",
  S7: "the decision step's GO conflicted with a prohibiting clause",
  S8: "no valid decision came back",
  S9: "text addressed to AI agents was found and set aside",
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (n: number) => n.toFixed(n > 0 && n < 0.01 ? 6 : 4);
const day = (iso: string) => iso.slice(0, 10);
const receipt = (origin: string, id: string | null) => (id ? `[receipt](${origin.replace(/\/$/, "")}/r/${id})` : "no receipt");

/** One line on why Izin's answer differs from the recorded one. */
export function explain(row: { final: string; serv: string | null; failure: string | null; ceilings: string[] }, mode: string): string {
  if (mode === "not_fetched") return "the host is on the do-not-fetch list, so nothing was read and the answer is ASK";
  const caps = row.ceilings.filter((c) => CEILING[c]).map((c) => `${c} (${CEILING[c]})`);
  if (row.failure) return `the decision step returned no valid answer (${row.failure})${caps.length ? `; ${caps.join(", ")}` : ""}`;
  if (caps.length && row.serv !== row.final) return `the decision step answered ${row.serv ?? "nothing"}; ${caps.join(", ")} set ${row.final}`;
  return `the decision step answered ${row.serv ?? row.final} from the quoted clauses${caps.length ? `; ${caps.join(", ")}` : ""}`;
}

export function benchSection(results: BenchResults, report: BenchReportFile, manual: ManualSet, origin: string): string {
  const shipped = report.shipped;
  const v = results.variants.find((x) => x.id === shipped)!;
  const sets = report.by_set[shipped]!;
  const lines = [
    "## Benchmark",
    "",
    `${report.runs ? `Runs: ${Object.entries(report.runs).map(([id, at]) => `${id} ${at}`).join(", ")}, each` : `Run ${report.run_at}`} by \`scripts/bench.ts\` on the sets committed before it ([ADR 0014](decisions/0014-pre-registered-benchmark-sets.md)). Each pair was collected and read once; every variant decided on the same frozen message (\`bench/evidence/\`), and the code ceilings were applied to each answer.${report.runs ? " A later run decided on that frozen message without reading any site again (`bench --from-evidence`); `scripts/bench-merge.ts` joins the runs." : ""}${report.stopped ? " The run stopped at the budget cap: the numbers cover the pairs it reached." : ""}`,
    "",
    `Shipped variant (K6: fewest false GO, then most agreement, then lowest cost; only SERV variants ship): **${shipped}** \`${v.model}\`.`,
    "",
    `False GO for the shipped variant: **${sets.B.false_go} of ${sets.B.pairs} designed cases** (Set B), **${sets.spot.false_go} of ${sets.spot.pairs} spot checks**, ${sets.A.false_go} of ${sets.A.pairs} Set A pairs.`,
    "",
    "### Variants",
    "",
    "| Variant | Model | Pairs | Agree | False GO | False NO-GO | No valid answer | Estimated cost per decision (USD) | Median decision time |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.variants.map(
      (x) =>
        `| ${x.id}${x.shipped ? " (shipped)" : ""} | \`${x.model}\` | ${x.pairs} | ${x.agree} (${pct(x.agree, x.pairs)}) | ${x.false_go} | ${x.false_no_go} | ${report.failures[x.id] ?? 0} | ${usd(x.cost_usd_per_decision)} | ${secs(x.median_ms)} |`,
    ),
    "",
    `V0 is the same rulebook sent to Dolphin's model with no SERV features. Costs are the spending guard's estimates (listed token price; SERV times the measured factor of [ADR 0016](decisions/0016-measured-serv-cost-and-frozen-rerun.md)), not provider invoices. Estimated total (reading and every variant): USD ${usd(results.total_cost_usd)}.`,
    "",
    "### By set",
    "",
    "| Variant | Set A agree | Set A false GO | Set B agree | Set B false GO | Spot agree | Spot false GO |",
    "|---|---|---|---|---|---|---|",
    ...results.variants.map((x) => {
      const s = report.by_set[x.id]!;
      return `| ${x.id} | ${s.A.agree} of ${s.A.pairs} | ${s.A.false_go} | ${s.B.agree} of ${s.B.pairs} | ${s.B.false_go} | ${s.spot.agree} of ${s.spot.pairs} | ${s.spot.false_go} |`;
    }),
    "",
    `### ${manual.label.split(":")[0]}`,
    "",
    manual.label,
    "",
    "Mapping from the recorded decision to a verdict:",
    "",
    ...manual.mapping.map((m) => `- ${m.recorded}: ${m.verdict}`),
    "",
    ...Object.entries(manual.modes).map(([k, t]) => `- \`${k}\`: ${t}`),
    "",
    "| Site | Action | Recorded | Mode | Izin | Match | Why they differ |",
    "|---|---|---|---|---|---|---|",
    ...results.set_a.map((r, i) => {
      const pair = manual.pairs[i]!;
      const row = report.rows[shipped]![`A${String(i + 1).padStart(2, "0")}`];
      const match = r.izin_verdict === r.human_verdict;
      return `| ${r.site} | ${r.action} | ${r.human_verdict} | ${pair.mode} | ${r.izin_verdict ?? "none"} (${receipt(origin, r.receipt_id)}) | ${match ? "yes" : "no"} | ${match || !row ? "" : explain(row, pair.mode)} |`;
    }),
    "",
    `Set A agreement, shipped variant: ${sets.A.agree} of ${sets.A.pairs}.`,
  ];
  return lines.join("\n");
}

/** How many gallery receipts got a valid answer from the decision step (read from the stored receipts). */
export interface GalleryDecided {
  with_receipt: number;
  serv_answered: number;
}

export function galleryRunSection(g: GalleryRunFile, h1: H1File | null, decided: GalleryDecided | null = null): string {
  const done = g.checks.filter((c) => c.verdict);
  const by = (v: string) => done.filter((c) => c.verdict === v).length;
  const ms = done.map((c) => c.ms_total).sort((a, b) => a - b);
  const med = ms.length ? (ms.length % 2 ? ms[ms.length >> 1]! : (ms[ms.length / 2 - 1]! + ms[ms.length / 2]!) / 2) : 0;
  const lines = [
    "## Gallery run",
    "",
    `Run ${g.run_at} by \`scripts/gallery.ts\` with \`${g.user_agent}\`: ${g.sites} sites, ${g.checks.length} checks, ${done.length} with a receipt${g.stopped ? " (stopped at the budget cap)" : ""}. GO ${by("GO")}, ASK ${by("ASK")}, NO-GO ${by("NO_GO")}. Median time per check ${secs(med)}, longest ${secs(ms.at(-1) ?? 0)}. Spend counted by the spending guard during the run, with the cost factor then in config (it under-counted SERV; [ADR 0016](decisions/0016-measured-serv-cost-and-frozen-rerun.md)): SERV USD ${usd(g.spend.serv_usd)}, Dolphin USD ${usd(g.spend.dolphin_usd)}.`,
  ];
  if (decided) {
    lines.push(
      "",
      `Receipts where the decision step gave a valid answer: **${decided.serv_answered} of ${decided.with_receipt}**. The others carry ceiling S8 (no valid decision came back) and stay at ASK; none of them is a GO.`,
    );
  }
  const errors = g.checks.filter((c) => c.error);
  if (errors.length) lines.push("", `Checks that ended in an error: ${errors.map((c) => `${c.site} ${c.action}`).join(", ")}.`);
  if (h1) {
    lines.push(
      "",
      `### H1: ten live sites, \`${h1.action}\`, limit ${secs(h1.max_ms)}`,
      "",
      `Run ${h1.run_at}. Result: **${h1.pass ? "pass" : "fail"}** (${h1.rows.filter((r) => r.receipt_id && !r.error && r.ms <= h1.max_ms).length} of ${h1.rows.length} finished with a receipt within the limit).`,
      "",
      "| Site | Verdict | Documents read | Time |",
      "|---|---|---|---|",
      ...h1.rows.map((r) => `| ${r.site} | ${r.verdict ?? `error: ${r.error}`} | ${r.docs_read} | ${secs(r.ms)} |`),
    );
  }
  return lines.join("\n");
}

/** H10 and the reader's speed, over the gallery and benchmark runs together. */
export function readerSection(runs: { name: string; reader: ReaderStats }[], at: string): string {
  const d = runs.reduce((s, r) => s + r.reader.tokens.dolphin, 0);
  const o = runs.reduce((s, r) => s + r.reader.tokens.other, 0);
  const lines = [
    "## Reader",
    "",
    `Generated ${day(at)} from the reader calls of the runs below. H10 asks that at least 80% of reader tokens are served by Dolphin.`,
    "",
    `Reader tokens served by Dolphin: **${d + o ? pct(d, d + o) : "n/a"}** (${d.toLocaleString("en-US")} of ${(d + o).toLocaleString("en-US")}).`,
    "",
    "| Run | Reader calls | Dolphin share | Dolphin median time | Median time to first token | Median output speed |",
    "|---|---|---|---|---|---|",
    ...runs.map(
      (r) =>
        `| ${r.name} | ${r.reader.calls} | ${r.reader.dolphin_share === null ? "n/a" : pct(r.reader.tokens.dolphin, r.reader.tokens.dolphin + r.reader.tokens.other)} | ${secs(r.reader.dolphin.median_ms)} | ${r.reader.dolphin.median_ttft_ms === null ? "n/a" : secs(r.reader.dolphin.median_ttft_ms)} | ${r.reader.dolphin.median_tokens_per_s ?? "n/a"} tokens/s |`,
    ),
    "",
    "A page already read is served from the reader cache and makes no call, so later runs over the same pages show fewer calls.",
  ];
  return lines.join("\n");
}
