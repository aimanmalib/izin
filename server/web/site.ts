// What the web pages need from the server besides receipts: one-click examples (config/examples.json),
// the web settings from config, and the measured cost per check from the stored receipts.
import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { z } from "zod";
import { ACTIONS, EXAMPLES_PATH, type IzinConfig } from "../config.js";

const examplesSchema = z
  .object({
    examples: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9_]*$/),
          site: z.url(),
          action: z.enum(ACTIONS),
          receipt_id: z.string().regex(/^[a-z2-7]{8,32}$/).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type Examples = z.infer<typeof examplesSchema>["examples"];

export function loadExamples(path: string = EXAMPLES_PATH): Examples {
  if (!existsSync(path)) return [];
  return examplesSchema.parse(JSON.parse(readFileSync(path, "utf8"))).examples;
}

export interface CostView {
  checks: number;
  reader_usd: number;
  decider_usd: number;
}

/** Average cost per finished check that reached the decision step, reader and decider apart; null before any. */
export function costView(db: Database.Database): CostView | null {
  const row = db
    .prepare<[], { n: number; reader: number | null; decider: number | null }>(
      `SELECT COUNT(*) AS n,
              AVG(COALESCE(json_extract(receipt_json, '$.reader.cost_usd'), 0)) AS reader,
              AVG(COALESCE(json_extract(receipt_json, '$.decider.cost_usd_estimated'), 0)) AS decider
       FROM checks
       WHERE status = 'done' AND receipt_json IS NOT NULL AND json_extract(receipt_json, '$.decider.model') IS NOT NULL`,
    )
    .get();
  if (!row || row.n === 0) return null;
  return { checks: row.n, reader_usd: row.reader ?? 0, decider_usd: row.decider ?? 0 };
}

export function siteView(cfg: IzinConfig, db: Database.Database, examples: Examples) {
  const w = cfg.web;
  return {
    origin: cfg.public_origin,
    repo_url: w.repo_url,
    action_order: w.action_order,
    gallery_excerpt: { rows: w.gallery_excerpt_rows, actions: w.gallery_excerpt_actions },
    poll_ms: w.poll_ms,
    step_ms: w.step_ms,
    tiers: { free_checks_per_hour: cfg.limits.rate_new_checks_per_ip_hour, ...w.tiers },
    detail_max_chars: cfg.limits.detail_max_chars,
    terms_text_max_chars: cfg.limits.terms_text_max_chars,
    examples,
    cost: costView(db),
    trap_url: w.trap_url,
    // Numbers the /bot and /docs pages state, read from the same limits the code enforces.
    bot: {
      user_agent: cfg.user_agent,
      requests_per_check: cfg.limits.requests_per_check,
      policy_docs_max: cfg.limits.policy_docs_max,
      host_interval_s: cfg.limits.host_interval_ms / 1000,
      crawl_delay_max_s: cfg.limits.crawl_delay_max_ms / 1000,
      fetch_timeout_s: cfg.limits.fetch_timeout_ms / 1000,
      no_refetch_days: cfg.limits.no_refetch_blocked_days,
    },
    api: {
      checks_per_day: cfg.limits.rate_new_checks_per_day,
      cache_hours: cfg.limits.cache_hours,
      mcp_wait_s: cfg.limits.mcp_wait_s,
    },
  };
}

export type SiteView = ReturnType<typeof siteView>;
