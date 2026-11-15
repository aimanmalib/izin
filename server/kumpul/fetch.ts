// One guarded GET: fixed IzinBot user agent, every redirect hop re-checked by the SSRF guard,
// connection pinned to the checked address, size and time limits, no retries. A compressed body
// is decoded here, so every later step sees the page and not its transport form.
import { createHash } from "node:crypto";
import { isIP, type LookupFunction } from "node:net";
import { Agent, request } from "undici";
import type { IzinConfig } from "../config.js";
import { contentCoding, decodeCapped, readCapped } from "./coding.js";
import { checkUrl, SsrfError, type NetPolicy } from "./ssrf.js";

export type FetchState = "ok" | "blocked" | "not_found" | "timeout" | "too_large" | "error" | "refused";

export interface FetchResult {
  url: string;
  final_url: string;
  status: number;
  content_type: string;
  body: Buffer;
  bytes: number;
  sha256: string | null;
  at: string;
  state: FetchState;
  note?: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface FetchOptions {
  cfg: IzinConfig;
  policy: NetPolicy;
  /** Hosts Izin never fetches from; a redirect into one is refused. */
  refuseHost?: (host: string) => boolean;
}

function pinnedAgent(address: string): Agent {
  const family = isIP(address);
  return new Agent({
    connect: {
      lookup: ((_host, opts, cb) => {
        if (opts?.all) (cb as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
        else cb(null, address, family);
      }) as LookupFunction,
    },
  });
}

function result(url: string, partial: Partial<FetchResult> & Pick<FetchResult, "state">): FetchResult {
  const body = partial.body ?? Buffer.alloc(0);
  return {
    url,
    final_url: partial.final_url ?? url,
    status: partial.status ?? 0,
    content_type: partial.content_type ?? "",
    body,
    bytes: body.length,
    sha256: body.length ? createHash("sha256").update(body).digest("hex") : null,
    at: new Date().toISOString(),
    ...(partial.note ? { note: partial.note } : {}),
    state: partial.state,
  };
}

export function looksBlocked(cfg: IzinConfig, status: number, body: Buffer): boolean {
  if (cfg.blocked_statuses.includes(status)) return true;
  const head = body.subarray(0, 256 * 1024).toString("utf8");
  return cfg.challenge_markers.some((m) => head.includes(m));
}

export async function fetchGuarded(rawUrl: string, opts: FetchOptions): Promise<FetchResult> {
  const { cfg, policy } = opts;
  const l = cfg.limits;
  const signal = AbortSignal.timeout(l.fetch_timeout_ms);
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= l.redirects_max; hop++) {
    if (opts.refuseHost?.(current.hostname)) {
      return result(rawUrl, { final_url: current.href, state: "refused", note: "do-not-fetch host" });
    }
    let address: string;
    try {
      address = await checkUrl(current, policy);
    } catch (e) {
      const why = e instanceof SsrfError ? e.reason : "invalid";
      return result(rawUrl, { final_url: current.href, state: "refused", note: why });
    }
    const agent = pinnedAgent(address);
    try {
      const res = await request(current, {
        method: "GET",
        dispatcher: agent,
        signal,
        headers: {
          "user-agent": cfg.user_agent,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "accept-language": "en",
        },
      });
      const location = res.headers.location;
      if (REDIRECTS.has(res.statusCode) && typeof location === "string") {
        await res.body.dump();
        current = new URL(location, current);
        continue;
      }
      const contentType = String(res.headers["content-type"] ?? "");
      const wire = await readCapped(res.body as AsyncIterable<Buffer>, l.response_max_bytes);
      if (wire.over) res.body.destroy();
      // The cap holds twice: on the bytes received and on the bytes they decode to.
      const coding = wire.buf.length ? contentCoding(res.headers["content-encoding"]) : null;
      const decoded = coding ? await decodeCapped(wire.buf, coding, l.response_max_bytes) : { ...wire, failed: false };
      const buf = decoded.buf;
      const base = { final_url: current.href, status: res.statusCode, content_type: contentType, body: buf };
      if (wire.over || decoded.over) return result(rawUrl, { ...base, state: "too_large" });
      if (looksBlocked(cfg, res.statusCode, buf)) return result(rawUrl, { ...base, state: "blocked" });
      if (res.statusCode === 404 || res.statusCode === 410) return result(rawUrl, { ...base, state: "not_found" });
      if (res.statusCode < 200 || res.statusCode >= 300) return result(rawUrl, { ...base, state: "error", note: "status" });
      if (decoded.failed) return result(rawUrl, { ...base, state: "error", note: `content-encoding ${coding}` });
      return result(rawUrl, { ...base, state: "ok" });
    } catch (e) {
      if (signal.aborted) return result(rawUrl, { final_url: current.href, state: "timeout" });
      return result(rawUrl, { final_url: current.href, state: "error", note: (e as Error).name });
    } finally {
      void agent.close();
    }
  }
  return result(rawUrl, { final_url: current.href, state: "error", note: "too many redirects" });
}

/** Decodes a body using the charset named in Content-Type, defaulting to UTF-8. */
export function decodeBody(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
