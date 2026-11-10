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
const regexSource = z.string().min(2);

const readerProvider = z
  .object({
    provider: z.enum(["dolphin", "serv"]),
    base_url: z.url(),
    model: z.string().min(1),
    key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    stream: z.boolean(),
  })
  .strict();

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
    discovery: z
      .object({
        input_path_pattern: regexSource,
        anchor_scores: z.array(z.object({ pattern: regexSource, score: positiveInt }).strict()).min(1),
        anchor_exclude_pattern: regexSource,
        common_paths: z.array(z.string().regex(/^\/[a-z0-9/_-]*$/)).min(1),
        multi_part_suffixes: z.array(z.string().regex(/^[a-z0-9-]+\.[a-z]{2,}$/)),
      })
      .strict(),
    robots_comments: z
      .object({
        min_chars: positiveInt,
        keywords: z.array(z.string().min(2)).min(1),
        boilerplate_markers: z.array(z.string().min(5)),
        policy_url_pattern: regexSource,
      })
      .strict(),
    // When robots.txt itself forbids the action for automated clients, the collector stops there.
    robots_stop: z
      .object({
        directive_actions: z.array(z.enum(ACTIONS)),
        prohibition: z.array(regexSource).min(1),
        automation: z.array(regexSource).min(1),
        any_action: z.array(regexSource).min(1),
        action_terms: z.record(z.enum(ACTIONS), z.array(regexSource)),
      })
      .strict(),
    limits: z
      .object({
        fetch_ports: z.array(z.number().int().min(1).max(65535)).min(1),
        requests_per_check: positiveInt,
        policy_docs_max: positiveInt,
        common_path_attempts_max: positiveInt,
        fetch_timeout_ms: positiveInt,
        response_max_bytes: positiveInt,
        redirects_max: positiveInt,
        host_interval_ms: positiveInt,
        crawl_delay_max_ms: positiveInt,
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
    reader: z
      .object({
        primary: readerProvider,
        fallback: readerProvider,
        prompt: z.string().regex(/^[a-z]+\.v\d+$/),
        temperature: z.number().min(0).max(2),
        max_tokens: positiveInt,
        timeout_ms: positiveInt,
        retry_after_max_s: positiveInt,
        json_retry_note: z.string().min(5),
        fallback_suspect_markers: z.array(z.string().min(3)),
        max_clauses: positiveInt,
        fragment_words: positiveInt,
        quarantine_max_chars: positiveInt,
      })
      .strict(),
    decider: z
      .object({
        base_url: z.url(),
        model: z.string().min(1),
        // Feature suffix on the model name; rung (c) of the fallback ladder drops it.
        suffix: z.string().regex(/^-[a-z-]+$/),
        key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        prompt: z.string().regex(/^[a-z]+\.v\d+$/),
        reasoning_effort: z.enum(["low", "medium", "high"]),
        timeout_ms: positiveInt,
        retries: z.number().int().min(0).max(3),
        retry_backoff_ms: z.number().int().nonnegative(),
        start_rung: z.enum(["a", "b", "c", "d"]),
        max_calls: positiveInt,
        shadow_hint: z.string().min(20),
        shadow_max_iterations: positiveInt,
        json_prompt_note: z.string().min(20),
        max_clauses: positiveInt,
        stance_priority: z.record(z.enum(STANCES), z.number().int().nonnegative()),
        max_decisive: positiveInt,
        max_conditions: positiveInt,
        max_missing: positiveInt,
        guard_refusal_markers: z.array(z.string().min(3)),
        shadow_exhausted_markers: z.array(z.string().min(3)),
      })
      .strict(),
    receipt: z
      .object({
        id_length: z.number().int().min(8).max(32),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
      })
      .strict(),
    alerts: z
      .object({
        command_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        language: z.enum(["en", "ms"]),
        level: z.enum(["info", "warn", "critical"]),
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
    const patterns: [string, string][] = [
      ...c.injection_patterns.map((p, i): [string, string] => [`injection_patterns.${i}`, p]),
      ["discovery.input_path_pattern", c.discovery.input_path_pattern],
      ["discovery.anchor_exclude_pattern", c.discovery.anchor_exclude_pattern],
      ...c.discovery.anchor_scores.map((a, i): [string, string] => [`discovery.anchor_scores.${i}`, a.pattern]),
      ["robots_comments.policy_url_pattern", c.robots_comments.policy_url_pattern],
    ];
    for (const [where, p] of patterns) {
      try {
        new RegExp(p, "iu");
      } catch {
        ctx.addIssue({ code: "custom", path: where.split("."), message: "invalid regular expression" });
      }
    }
    for (const s of STANCES) {
      if (c.decider.stance_priority[s] === undefined) ctx.addIssue({ code: "custom", path: ["decider", "stance_priority", s], message: "missing stance" });
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

// Paths resolve the same way from server/ (tsx) and from the bundled dist/ file.
export const CONFIG_PATH = fileURLToPath(new URL("../config/izin.json", import.meta.url));
export const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));
export const LANG_DIR = fileURLToPath(new URL("../lang/", import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function parseConfig(raw: unknown): IzinConfig {
  return configSchema.parse(raw);
}

export function loadConfig(path: string = process.env.IZIN_CONFIG ?? CONFIG_PATH): IzinConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
