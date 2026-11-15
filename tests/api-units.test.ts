// Pieces of the API that need no server: client address, input checks (H8 at the API level),
// detail redaction, spend accounting, the per-address rate window and the job queue.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { makeClientIp } from "../server/api/clientip.js";
import { assertFetchable, parseCheckRequest, redactDetail, type InvalidInput } from "../server/api/input.js";
import { JobQueue } from "../server/api/queue.js";
import { IpRateLimit, secondsToUtcMidnight } from "../server/api/ratelimit.js";
import { spendOf } from "../server/belanja/guard.js";
import type { DocReading } from "../server/baca/reader.js";
import type { DeciderResult } from "../server/putus/serv.js";
import { CheckJobs } from "../server/resit/jobs.js";
import { ReceiptStore } from "../server/resit/store.js";
import { testConfig } from "./helpers/sites.js";

const cfg = testConfig();

describe("client address", () => {
  const ip = makeClientIp(cfg);
  const edge = "162.158.1.2"; // inside a Cloudflare range from config

  it("ignores forwarding headers from a peer that is not the proxy", () => {
    expect(ip("198.51.100.7", { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": edge })).toBe("198.51.100.7");
  });

  it("believes cf-connecting-ip only when the proxy saw a Cloudflare edge", () => {
    expect(ip("::ffff:172.18.0.3", { "x-forwarded-for": edge, "cf-connecting-ip": "203.0.113.9" })).toBe("203.0.113.9");
    expect(ip("172.18.0.3", { "x-forwarded-for": "198.51.100.8", "cf-connecting-ip": "203.0.113.9" })).toBe("198.51.100.8");
    // A client-written X-Forwarded-For entry before the real hop does not count.
    expect(ip("172.18.0.3", { "x-forwarded-for": `${edge}, 198.51.100.8`, "cf-connecting-ip": "203.0.113.9" })).toBe("198.51.100.8");
  });
});

describe("check input", () => {
  const ok = { url: "https://Shop.Example.co.uk/item?x=1#frag", action: "purchase" };
  const code = (body: unknown) => {
    try {
      parseCheckRequest(cfg, body);
      return "ok";
    } catch (e) {
      return (e as InvalidInput).code;
    }
  };

  it("normalises the URL and derives the cache keys", () => {
    const r = parseCheckRequest(cfg, ok);
    expect(r).toMatchObject({ url: "https://shop.example.co.uk/item?x=1", origin: "https://shop.example.co.uk", site: "example.co.uk", detail: null, agent: null });
  });

  it("refuses bad actions, schemes, hosts, lengths and agent tokens", () => {
    expect(code({ ...ok, action: "delete" })).toBe("invalid_action");
    expect(code({ url: ok.url })).toBe("invalid_action");
    for (const url of ["ftp://example.com/", "file:///etc/passwd", "http://localhost/", "http://intranet/", "https://u:p@example.com/", "not a url"]) {
      expect(code({ ...ok, url }), url).toBe("invalid_url");
    }
    expect(code({ ...ok, detail: "x".repeat(cfg.limits.detail_max_chars + 1) })).toBe("detail_too_long");
    expect(code({ ...ok, agent: "Bad Agent/1.0" })).toBe("invalid_agent");
    expect(code({ ...ok, agent: "ExampleAgent" })).toBe("ok");
  });

  it("removes email addresses and phone numbers from the detail", () => {
    const out = redactDetail(cfg, "Order for jane.doe+x@example.org, call +60 12-345 6789 before 5pm, 2 items");
    expect(out).toBe("Order for [email], call [phone] before 5pm, 2 items");
    expect(parseCheckRequest(cfg, { ...ok, detail: "mail a@b.io" }).detail).toBe("mail [email]");
  });

  it("H8: private, loopback, link-local, metadata, CGNAT and other ports are refused before queueing", async () => {
    const bad = [
      "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.0.1/", "http://172.16.5.5/", "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/", "http://[::1]/", "http://[fe80::1]/", "http://0.0.0.0/", "https://93.184.215.14:8443/",
    ];
    for (const url of bad) {
      const req = parseCheckRequest(cfg, { url, action: "read_page" });
      await expect(assertFetchable(cfg, req), url).rejects.toMatchObject({ code: "url_not_allowed" });
    }
    const viaDns = parseCheckRequest(cfg, { url: "https://inside.example/", action: "read_page" });
    const policy = { lookup: async () => ["10.0.0.5"], ipAllowed: () => false, ports: [80, 443] };
    await expect(assertFetchable(cfg, viaDns, policy)).rejects.toMatchObject({ code: "url_not_allowed" });
  });
});

const attempt = (provider: string, cost: number | null, inTok = 1000, outTok = 1000) => ({
  provider, model: "m", outcome: "ok" as const, ms: 1, ttft_ms: null, input_tokens: inTok, output_tokens: outTok,
  reasoning_tokens: null, reasoning_deltas: 0, cost_usd: cost, response_model: null, fallback_suspected: false,
});

describe("spend accounting", () => {
  it("splits reader cost by provider and adds the decider estimate to SERV", () => {
    const readings = [{ attempts: [attempt("dolphin", 0.001), attempt("serv", 0.002)] }] as unknown as DocReading[];
    const decider = { cost_usd_estimated: 0.01, tokens_in: 0, tokens_out: 0 } as DeciderResult;
    const s = spendOf(cfg, readings, decider);
    expect(s.dolphin_usd).toBeCloseTo(0.001, 9);
    expect(s.serv_usd).toBeCloseTo(0.012, 9);
  });

  it("prices an unlisted model at the provider's highest listed price, never at zero", () => {
    const readings = [{ attempts: [attempt("dolphin", null, 1_000_000, 0)] }] as unknown as DocReading[];
    const top = Math.max(...Object.values(cfg.prices_usd_per_mtok.dolphin).map((p) => p.input));
    expect(spendOf(cfg, readings, null).dolphin_usd).toBeCloseTo(top, 9);
    const decider = { cost_usd_estimated: null, tokens_in: 1_000_000, tokens_out: 0 } as DeciderResult;
    expect(spendOf(cfg, [], decider).serv_usd).toBeGreaterThan(0);
  });
});

describe("rate window (H7, fake clock)", () => {
  it("allows N new checks an hour per address, then reopens as the window slides", () => {
    let t = 1_000_000;
    const rl = new IpRateLimit(2, () => t);
    rl.note("a");
    t += 600_000;
    rl.note("a");
    expect(rl.retryAfter("a")).toBe(3000);
    expect(rl.retryAfter("b")).toBe(0);
    t += 3000 * 1000;
    expect(rl.retryAfter("a")).toBe(0);
  });

  it("counts the daily limit's wait to the next UTC midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-10T23:59:00Z"))).toBe(60);
  });
});

describe("job queue", () => {
  const setup = (timeoutMs = 1000) => {
    const db = new Database(":memory:");
    new ReceiptStore(db);
    const jobs = new CheckJobs(db);
    const req = parseCheckRequest(cfg, { url: "https://a.example/", action: "read_page" });
    const add = (id: string) => jobs.insertQueued(id, req, "api", new Date());
    return { db, jobs, add, queue: new JobQueue(jobs, 2, timeoutMs) };
  };

  it("answers a host with and without www from the newest of the two", () => {
    const { jobs } = setup();
    const bare = parseCheckRequest(cfg, { url: "https://a.example/", action: "purchase" });
    const www = parseCheckRequest(cfg, { url: "https://www.a.example/", action: "purchase" });
    jobs.insertQueued("old", bare, "api", new Date("2026-11-15T10:00:00Z"));
    jobs.insertQueued("new", www, "api", new Date("2026-11-15T12:00:00Z"));
    const since = new Date("2026-11-15T00:00:00Z");
    expect(jobs.findCached(bare.origin, "purchase", since)?.id).toBe("new");
    expect(jobs.findCached(www.origin, "purchase", since)?.id).toBe("new");
    expect(jobs.findCached("https://other.example", "purchase", since)).toBeNull();
  });

  it("runs at most two checks at once", async () => {
    const { add, queue } = setup();
    let running = 0;
    let peak = 0;
    const job = (id: string) => {
      add(id);
      return { id, run: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 20)); running--; } };
    };
    for (const id of ["j1", "j2", "j3", "j4", "j5"]) queue.push(job(id));
    await queue.idle();
    expect(peak).toBe(2);
  });

  it("a check past the timeout is an error; a failure is an error; neither leaves it running", async () => {
    const { add, jobs, queue } = setup(30);
    add("slow");
    add("boom");
    queue.push({ id: "slow", run: () => new Promise((r) => setTimeout(r, 80)) });
    queue.push({ id: "boom", run: () => Promise.reject(new Error("x")) });
    expect(await queue.wait("slow", 1000)).toBe("error");
    expect(await queue.wait("boom", 1000)).toBe("error");
    await queue.idle();
    expect(jobs.get("slow")?.status).toBe("error");
  });

  it("marks rows left queued or running by a stopped process as errors", () => {
    const { add, jobs } = setup();
    add("q1");
    add("q2");
    jobs.setStatus("q2", "running");
    expect(jobs.recoverOrphans()).toBe(2);
    expect(jobs.get("q1")?.status).toBe("error");
  });
});
