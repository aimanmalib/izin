// Loads and validates config/izin.json. Every value that may change lives in that file;
// code reads it and never keeps its own copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ACTIONS = ["read_page", "crawl", "train", "account", "purchase", "post"] as const;
export const STANCES = ["prohibits", "restricts", "requires", "permits", "unclear"] as const;
export const VERDICTS = ["NO_GO", "ASK", "GO"] as const;

export type Action = (typeof ACTIONS)[number];
export type Stance = (typeof STANCES)[number];
export type Verdict = (typeof VERDICTS)[number];

const price = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }).strict();
const positiveInt = z.number().int().positive();

export const configSchema = z
  .object({
    version: z.literal(1),
    user_agent: z.string().regex(/^IzinBot\/\d+\.\d+ \(\+https:\/\/\S+\/bot\)$/),
    public_origin: z.url(),
    actions: z.tuple([
      z.literal("read_page"),
      z.literal("crawl"),
      z.literal("train"),
      z.literal("account"),
      z.literal("purchase"),
      z.literal("post"),
    ]),
    categories: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
    stances: z.array(z.enum(STANCES)).length(STANCES.length),
    // Strictest first: the final verdict is the earliest one any rule produces.
    verdicts: z.tuple([z.literal("NO_GO"), z.literal("ASK"), z.literal("GO")]),
    relevance: z.record(z.enum(ACTIONS), z.array(z.string()).min(1)),
    prices_usd_per_mtok: z
      .object({ serv: z.record(z.string(), price), dolphin: z.record(z.string(), price) })
      .strict(),
    budget: z
      .object({
        serv_usd_per_day: z.number().positive(),
        serv_usd_total: z.number().positive(),
        dolphin_usd_per_day: z.number().positive(),
        dolphin_usd_total: z.number().positive(),
        serv_cost_factor: z.number().min(1),
      })
      .strict(),
    do_not_fetch_hosts: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)),
    challenge_markers: z.array(z.string().min(3)).min(1),
    blocked_statuses: z.array(z.number().int().min(400).max(599)).min(1),
    injection_patterns: z.array(z.string().min(3)).min(1),
    limits: z
      .object({
        requests_per_check: positiveInt,
        policy_docs_max: positiveInt,
        common_path_attempts_max: positiveInt,
        fetch_timeout_ms: positiveInt,
        response_max_bytes: positiveInt,
        redirects_max: positiveInt,
        host_interval_ms: positiveInt,
        doc_text_min_chars: positiveInt,
        doc_text_max_chars: positiveInt,
        terms_text_max_chars: positiveInt,
        detail_max_chars: positiveInt,
        quote_min_chars: positiveInt,
        quote_max_chars: positiveInt,
        check_timeout_s: positiveInt,
        server_timeout_s: positiveInt,
        mcp_wait_s: positiveInt,
        queue_concurrency: positiveInt,
        cache_hours: positiveInt,
        cached_receipt_days: positiveInt,
        no_refetch_blocked_days: positiveInt,
        rate_new_checks_per_ip_hour: positiveInt,
        rate_new_checks_per_day: positiveInt,
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const known = new Set(c.categories);
    for (const action of ACTIONS) {
      const cats = c.relevance[action];
      if (!cats) ctx.addIssue({ code: "custom", path: ["relevance", action], message: "missing action" });
      for (const cat of cats ?? []) {
        if (!known.has(cat)) ctx.addIssue({ code: "custom", path: ["relevance", action], message: `unknown category ${cat}` });
      }
    }
    for (const [i, p] of c.injection_patterns.entries()) {
      try {
        new RegExp(p, "iu");
      } catch {
        ctx.addIssue({ code: "custom", path: ["injection_patterns", i], message: "invalid regular expression" });
      }
    }
    const l = c.limits;
    if (l.quote_min_chars >= l.quote_max_chars) ctx.addIssue({ code: "custom", path: ["limits"], message: "quote range" });
    if (l.check_timeout_s >= l.server_timeout_s) ctx.addIssue({ code: "custom", path: ["limits"], message: "check must end before server timeout" });
    if (l.policy_docs_max >= l.requests_per_check) ctx.addIssue({ code: "custom", path: ["limits"], message: "policy docs exceed request budget" });
    if (c.budget.serv_usd_per_day > c.budget.serv_usd_total || c.budget.dolphin_usd_per_day > c.budget.dolphin_usd_total) {
      ctx.addIssue({ code: "custom", path: ["budget"], message: "daily cap above total cap" });
    }
  });

export type IzinConfig = z.infer<typeof configSchema>;

export const CONFIG_PATH = fileURLToPath(new URL("../config/izin.json", import.meta.url));

export function parseConfig(raw: unknown): IzinConfig {
  return configSchema.parse(raw);
}

export function loadConfig(path: string = process.env.IZIN_CONFIG ?? CONFIG_PATH): IzinConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
