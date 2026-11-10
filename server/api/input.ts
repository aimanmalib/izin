// Validation of one check request, shared by the HTTP API and the MCP tools. Bad input is
// refused before anything is queued: unknown action, a URL that is not public http(s), an
// over-long detail. Email addresses and phone numbers are removed from the detail (it may reach
// a model and is stored on the receipt).
import { ACTIONS, type Action, type IzinConfig } from "../config.js";
import { registrableDomain } from "../kumpul/discover.js";
import { checkUrl, defaultPolicy, hostAllowed, type NetPolicy } from "../kumpul/ssrf.js";

export interface CheckRequest {
  url: string;
  action: Action;
  detail: string | null;
  terms_text: string | null;
  agent: string | null;
  /** Normalised origin and registrable domain, the cache keys. */
  origin: string;
  site: string;
}

export type InputError = "invalid_url" | "invalid_action" | "detail_too_long" | "terms_too_long" | "invalid_agent" | "url_not_allowed";

export class InvalidInput extends Error {
  constructor(readonly code: InputError) {
    super(code);
  }
}

// A user-agent product token as robots.txt groups name it.
const AGENT_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

export function redactDetail(cfg: IzinConfig, detail: string): string {
  let out = detail;
  for (const r of cfg.privacy.detail_redact) out = out.replace(new RegExp(r.pattern, "gu"), r.label);
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Shape and length checks only; no network. */
export function parseCheckRequest(cfg: IzinConfig, body: unknown): CheckRequest {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = str(b.action);
  if (!action || !(ACTIONS as readonly string[]).includes(action)) throw new InvalidInput("invalid_action");
  let url: URL;
  try {
    url = new URL(str(b.url) ?? "");
  } catch {
    throw new InvalidInput("invalid_url");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !hostAllowed(url.hostname)) throw new InvalidInput("invalid_url");
  url.hash = "";
  const detail = str(b.detail);
  if (detail && detail.length > cfg.limits.detail_max_chars) throw new InvalidInput("detail_too_long");
  const terms = str(b.terms_text);
  if (terms && terms.length > cfg.limits.terms_text_max_chars) throw new InvalidInput("terms_too_long");
  const agent = str(b.agent);
  if (agent && !AGENT_TOKEN.test(agent)) throw new InvalidInput("invalid_agent");
  return {
    url: url.href,
    action: action as Action,
    detail: detail ? redactDetail(cfg, detail) : null,
    terms_text: terms,
    agent,
    origin: url.origin.toLowerCase(),
    site: registrableDomain(url.hostname, cfg),
  };
}

/** The SSRF rules applied to the input URL itself, so a private address is a 400, not a queued check. */
export async function assertFetchable(cfg: IzinConfig, req: CheckRequest, policy?: NetPolicy): Promise<void> {
  try {
    await checkUrl(new URL(req.url), policy ?? defaultPolicy(cfg.limits.fetch_ports));
  } catch {
    throw new InvalidInput("url_not_allowed");
  }
}
