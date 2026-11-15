// What the OpenServ capability does: ask the public Izin API for one check and wait for its receipt.
// No dependency on the agent SDK, so the logic is tested with a stand-in fetch (tests/openserv-check.test.ts).
// The API applies its own rules (saved answers, rate limit, spending cap); this code only reports them.

export const ACTIONS = ["read_page", "crawl", "train", "account", "purchase", "post"] as const;
export type Action = (typeof ACTIONS)[number];

export interface IzinApi {
  /** Public origin of the Izin instance, without a trailing slash. */
  origin: string;
  fetch: typeof fetch;
  /** Time between receipt polls and the longest wait for a running check. */
  pollMs: number;
  waitMs: number;
  /** Sent with a new check so the listing has its own hourly allowance; read when the check starts. */
  marketKey?: () => string | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Answer {
  verdict: "GO" | "ASK" | "NO_GO";
  site: string;
  action: string;
  reason: string;
  conditions: string[];
  missing: string[];
  decisive_clauses: { quote: string; stance: string; source: string }[];
  checked_at: string;
  /** True when the answer came from a receipt that was already saved. */
  saved: boolean;
  receipt_url: string;
}

export type Outcome =
  | { ok: true; answer: Answer }
  | { ok: false; error: "invalid_input" | "rate_limited" | "paused" | "still_running" | "failed" | "unreachable"; detail?: string; retry_after_s?: number; receipt_url?: string };

interface StoredClause {
  quote: string;
  stance: string;
  decisive: boolean;
  source_url: string;
  fragment_url: string | null;
}

interface StoredReceipt {
  id: string;
  created_at: string;
  site: string;
  action: string;
  verdict: Answer["verdict"];
  reason: string;
  conditions: string[];
  missing: string[];
  clauses: StoredClause[];
}

const receiptUrl = (api: IzinApi, id: string) => `${api.origin}/r/${id}`;

function toAnswer(api: IzinApi, r: StoredReceipt, saved: boolean): Answer {
  return {
    verdict: r.verdict,
    site: r.site,
    action: r.action,
    reason: r.reason,
    conditions: r.conditions,
    missing: r.missing,
    decisive_clauses: r.clauses
      .filter((c) => c.decisive)
      .slice(0, 3)
      .map((c) => ({ quote: c.quote, stance: c.stance, source: c.fragment_url ?? c.source_url })),
    checked_at: r.created_at,
    saved,
    receipt_url: receiptUrl(api, r.id),
  };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Polls the receipt until it is done, failed, or the wait runs out. */
async function waitForReceipt(api: IzinApi, id: string, saved: boolean): Promise<Outcome> {
  const sleep = api.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = api.now ?? Date.now;
  const until = now() + api.waitMs;
  for (;;) {
    const res = await api.fetch(`${api.origin}/api/receipt/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
    const body = await json(res);
    if (res.ok && body.status === "done" && body.receipt) return { ok: true, answer: toAnswer(api, body.receipt as StoredReceipt, saved) };
    if (!res.ok || body.status === "error") return { ok: false, error: "failed", receipt_url: receiptUrl(api, id) };
    if (now() >= until) return { ok: false, error: "still_running", receipt_url: receiptUrl(api, id) };
    await sleep(api.pollMs);
  }
}

export async function checkOnIzin(api: IzinApi, input: { url: string; action: string }): Promise<Outcome> {
  if (!(ACTIONS as readonly string[]).includes(input.action)) return { ok: false, error: "invalid_input", detail: "invalid_action" };
  const key = api.marketKey?.();
  let res: Response;
  try {
    res = await api.fetch(`${api.origin}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(key ? { "x-izin-market-key": key } : {}) },
      body: JSON.stringify({ url: input.url, action: input.action }),
    });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  const body = await json(res);
  try {
    if (res.status === 202 && typeof body.id === "string") return await waitForReceipt(api, body.id, body.cached === true);
    if (res.status === 400) return { ok: false, error: "invalid_input", detail: String(body.error ?? "invalid_url") };
    if (res.status === 429) return { ok: false, error: "rate_limited", retry_after_s: Number(body.retry_after_s ?? 60) };
    if (res.status === 503) {
      // New checks are paused by a spending cap; a recent receipt for the same pair is still an answer.
      if (typeof body.cached_id === "string") return await waitForReceipt(api, body.cached_id, true);
      return { ok: false, error: "paused" };
    }
  } catch {
    return { ok: false, error: "unreachable" };
  }
  return { ok: false, error: "failed" };
}
