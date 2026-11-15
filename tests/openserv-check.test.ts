// The capability behind the OpenServ listing (openserv/check.ts): it asks the public Izin API for one
// check, waits for the receipt and reports the API's own limits as they are. A stand-in fetch plays the API.
import { describe, expect, it } from "vitest";
import { checkOnIzin, type IzinApi } from "../openserv/check.js";

const RECEIPT = {
  id: "abcdefghij",
  created_at: "2026-11-10T21:01:34.589Z",
  site: "shop.example",
  action: "purchase",
  verdict: "NO_GO",
  reason: "The terms forbid automated purchases.",
  conditions: [],
  missing: [],
  clauses: [
    { quote: "Automated purchasing is not allowed.", stance: "prohibits", decisive: true, source_url: "https://shop.example/terms", fragment_url: "https://shop.example/terms#:~:text=Automated" },
    { quote: "We may change these terms.", stance: "unclear", decisive: false, source_url: "https://shop.example/terms", fragment_url: null },
  ],
};

type Step = { status: number; body: unknown };

function fakeApi(steps: Record<string, Step[]>, extra: Partial<IzinApi> = {}) {
  const calls: string[] = [];
  let clock = 0;
  const api: IzinApi = {
    origin: "https://izin.test",
    pollMs: 1000,
    waitMs: 5000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input).replace("https://izin.test", "");
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const queue = steps[url];
      if (!queue?.length) throw new Error(`no step for ${url}`);
      const step = queue.length > 1 ? queue.shift()! : queue[0]!;
      return new Response(JSON.stringify(step.body), { status: step.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    ...extra,
  };
  return { api, calls };
}

describe("checkOnIzin", () => {
  it("returns the saved answer in short form with the receipt link", async () => {
    const { api, calls } = fakeApi({
      "/api/check": [{ status: 202, body: { id: "abcdefghij", status: "done", cached: true } }],
      "/api/receipt/abcdefghij": [{ status: 200, body: { status: "done", receipt: RECEIPT } }],
    });
    const r = await checkOnIzin(api, { url: "https://shop.example/", action: "purchase" });
    expect(r).toEqual({
      ok: true,
      answer: {
        verdict: "NO_GO",
        site: "shop.example",
        action: "purchase",
        reason: "The terms forbid automated purchases.",
        conditions: [],
        missing: [],
        decisive_clauses: [{ quote: "Automated purchasing is not allowed.", stance: "prohibits", source: "https://shop.example/terms#:~:text=Automated" }],
        checked_at: "2026-11-10T21:01:34.589Z",
        saved: true,
        receipt_url: "https://izin.test/r/abcdefghij",
      },
    });
    expect(calls).toEqual(["POST /api/check", "GET /api/receipt/abcdefghij"]);
  });

  it("waits for a fresh check and says so when it is still running at the end of the wait", async () => {
    const done = fakeApi({
      "/api/check": [{ status: 202, body: { id: "abcdefghij", status: "queued", cached: false } }],
      "/api/receipt/abcdefghij": [{ status: 200, body: { status: "running" } }, { status: 200, body: { status: "running" } }, { status: 200, body: { status: "done", receipt: RECEIPT } }],
    });
    const r = await checkOnIzin(done.api, { url: "https://shop.example/", action: "purchase" });
    expect(r.ok && r.answer.saved).toBe(false);
    expect(done.calls.filter((c) => c.startsWith("GET"))).toHaveLength(3);

    const slow = fakeApi({
      "/api/check": [{ status: 202, body: { id: "abcdefghij", status: "queued", cached: false } }],
      "/api/receipt/abcdefghij": [{ status: 200, body: { status: "running" } }],
    });
    expect(await checkOnIzin(slow.api, { url: "https://shop.example/", action: "purchase" })).toEqual({
      ok: false,
      error: "still_running",
      receipt_url: "https://izin.test/r/abcdefghij",
    });
  });

  it("reports the API's refusals as they are", async () => {
    const bad = fakeApi({ "/api/check": [{ status: 400, body: { error: "url_not_allowed" } }] });
    expect(await checkOnIzin(bad.api, { url: "http://127.0.0.1/", action: "crawl" })).toEqual({ ok: false, error: "invalid_input", detail: "url_not_allowed" });
    const limited = fakeApi({ "/api/check": [{ status: 429, body: { error: "rate_limited", scope: "ip", retry_after_s: 420 } }] });
    expect(await checkOnIzin(limited.api, { url: "https://shop.example/", action: "crawl" })).toEqual({ ok: false, error: "rate_limited", retry_after_s: 420 });
    const paused = fakeApi({ "/api/check": [{ status: 503, body: { error: "budget_exhausted" } }] });
    expect(await checkOnIzin(paused.api, { url: "https://shop.example/", action: "crawl" })).toEqual({ ok: false, error: "paused" });
  });

  it("answers from the recent receipt the API names when new checks are paused", async () => {
    const { api } = fakeApi({
      "/api/check": [{ status: 503, body: { error: "budget_exhausted", cached_id: "abcdefghij" } }],
      "/api/receipt/abcdefghij": [{ status: 200, body: { status: "done", receipt: RECEIPT } }],
    });
    const r = await checkOnIzin(api, { url: "https://shop.example/", action: "purchase" });
    expect(r.ok && r.answer.saved).toBe(true);
  });

  it("refuses an unknown action without calling the API, and reports an unreachable API", async () => {
    const { api, calls } = fakeApi({});
    expect(await checkOnIzin(api, { url: "https://shop.example/", action: "fly" })).toEqual({ ok: false, error: "invalid_input", detail: "invalid_action" });
    expect(calls).toEqual([]);
    const down = fakeApi({}, { fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    expect(await checkOnIzin(down.api, { url: "https://shop.example/", action: "crawl" })).toEqual({ ok: false, error: "unreachable" });
  });

  it("sends the market key with a new check when one is set", async () => {
    const seen: (string | null)[] = [];
    const { api } = fakeApi({}, {
      marketKey: () => "secret-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("x-izin-market-key"));
        return new Response(JSON.stringify({ error: "budget_exhausted" }), { status: 503 });
      }) as typeof fetch,
    });
    await checkOnIzin(api, { url: "https://shop.example/", action: "crawl" });
    expect(seen).toEqual(["secret-key"]);
  });

  it("treats a failed check as no verdict", async () => {
    const { api } = fakeApi({
      "/api/check": [{ status: 202, body: { id: "abcdefghij", status: "queued", cached: false } }],
      "/api/receipt/abcdefghij": [{ status: 200, body: { status: "error" } }],
    });
    expect(await checkOnIzin(api, { url: "https://shop.example/", action: "crawl" })).toEqual({ ok: false, error: "failed", receipt_url: "https://izin.test/r/abcdefghij" });
  });
});
