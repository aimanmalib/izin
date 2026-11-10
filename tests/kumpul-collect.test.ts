// Collector end to end against a local server with synthetic sites (no outside network).
import { afterEach, describe, expect, it } from "vitest";
import { collect, type CollectInput } from "../server/kumpul/collect.js";
import { page, policyText, startSites, testConfig, type Running, type Sites } from "./helpers/sites.js";
import type { IzinConfig } from "../server/config.js";

let s: Running | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

type Def = Sites | ((url: (h: string, p?: string) => string) => Sites);

async function run(def: Def, input: (r: Running) => CollectInput, cfg: IzinConfig = testConfig()) {
  const r = (s = await startSites(def));
  const out = await collect(input(r), { cfg, policy: r.policy });
  return { out, r, cfg };
}

const txt = (body: string) => ({ type: "text/plain", body });
const footer = '<a href="/terms">Terms of Service</a> <a href="/privacy">Privacy</a> <a href="/acceptable-use">Acceptable use</a>';
const shopComment =
  "# Automated agents and bots must not complete checkout on this store. Buying agents must use the official route in our terms and must identify themselves. Other automated purchases are prohibited.\n# Accounts may not be created by automated means.";

describe("collect", () => {
  it("reads robots, home, scored policy pages and a policy URL named in robots comments on another domain", async () => {
    const { out, r, cfg } = await run(
      (url) => ({
        "shop.example": {
          "/robots.txt": txt(`${shopComment}\n# Terms: ${url("legal.example", "/legal/terms")}\nUser-agent: *\nContent-Signal: ai-train=no\nDisallow: /cart\n`),
          "/": { body: page("<h1>Shop</h1>", footer) },
          "/terms": { body: page(policyText("terms")) },
          "/acceptable-use": { body: page(policyText("acceptable use")) },
          "/privacy": { body: page(policyText("privacy")) },
        },
        "legal.example": { "/legal/terms": { body: page(policyText("platform terms")) } },
      }),
      (rr) => ({ url: rr.url("shop.example", "/products/1"), agent: "GPTBot" }),
    );
    expect(out.mode).toBe("fetch");
    expect(out.site).toBe("shop.example");
    expect(out.docs.map((d) => [d.kind, new URL(d.url).hostname + new URL(d.url).pathname])).toEqual([
      ["robots_comments", "shop.example/robots.txt"],
      ["policy", "legal.example/legal/terms"],
      ["policy", "shop.example/terms"],
      ["policy", "shop.example/acceptable-use"],
    ]);
    expect(out.docs.every((d) => d.to_model && d.origin_verified)).toBe(true);
    expect(out.signals).toMatchObject({ docs_read: 4, unreadable: [], blocked: [], ai_input_no: false, do_not_fetch: false });
    expect(out.robots?.content_signal.any).toEqual({ "ai-train": "no" });
    expect(out.robots?.input_disallowed).toEqual({ izinbot: false, any: false, agent: false });
    // The other domain's robots.txt is read before its page is fetched.
    expect(out.ledger.map((e) => e.kind)).toEqual(["robots", "input", "home", "robots", "policy", "policy", "policy"]);
    expect(out.requests_used).toBeLessThanOrEqual(cfg.limits.requests_per_check);
    expect(r.hits.some((h) => h.path === "/privacy")).toBe(false);
    expect(new Set(r.hits.map((h) => h.headers["user-agent"]))).toEqual(new Set([cfg.user_agent]));
    for (const e of out.ledger) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fetches nothing from a do-not-fetch host, and paste mode still works", async () => {
    const { out, r } = await run({}, () => ({ url: "https://sub.devpost.com/rules", terms_text: policyText("pasted") }));
    expect(out.mode).toBe("do_not_fetch");
    expect(out.ledger).toEqual([]);
    expect(r.hits).toEqual([]);
    expect(out.signals.do_not_fetch).toBe(true);
    expect(out.docs).toMatchObject([{ kind: "pasted", origin_verified: false, to_model: true }]);
  });

  it("paste mode reads robots.txt only", async () => {
    const { out } = await run({ "shop.example": { "/robots.txt": txt("User-agent: *\nDisallow:\n"), "/": { body: page("x", footer) } } }, (rr) => ({
      url: rr.url("shop.example"),
      terms_text: policyText("pasted"),
    }));
    expect(out.mode).toBe("paste");
    expect(out.ledger.map((e) => e.kind)).toEqual(["robots"]);
    expect(out.signals.docs_read).toBe(1);
  });

  it("obeys robots.txt for its own fetches and reports the skipped page as unreadable", async () => {
    const { out, r } = await run(
      {
        "shop.example": {
          "/robots.txt": txt("User-agent: IzinBot\nDisallow: /terms\n"),
          "/": { body: page("x", footer) },
          "/acceptable-use": { body: page(policyText("aup")) },
        },
      },
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(r.hits.some((h) => h.path === "/terms")).toBe(false);
    expect(out.signals.unreadable).toEqual([{ url: r.url("shop.example", "/terms"), state: "robots_disallow" }]);
    expect(out.signals.docs_read).toBe(1);
  });

  it("gives no page text to a model when the site signals ai-input=no", async () => {
    const { out, r } = await run(
      { "shop.example": { "/robots.txt": txt(`${shopComment}\nUser-agent: *\nContent-Signal: ai-input=no\n`), "/": { body: page("x", footer) } } },
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(out.signals.ai_input_no).toBe(true);
    expect(r.hits.map((h) => h.path)).toEqual(["/robots.txt"]);
    expect(out.docs.map((d) => d.to_model)).toEqual([false]);
  });

  it("marks short pages needs_browser and long ones truncated, both unreadable; dead links are not", async () => {
    const cfg = testConfig({ doc_text_max_chars: 1500 });
    const { out, r } = await run(
      {
        "shop.example": {
          "/robots.txt": txt(""),
          "/": { body: page("x", '<a href="/terms">Terms</a><a href="/legal">Legal</a><a href="/user-agreement">User agreement</a>') },
          "/terms": { body: page("<div id=root>Loading</div>") },
          "/legal": { body: page(policyText("long", 4000)) },
        },
      },
      (rr) => ({ url: rr.url("shop.example") }),
      cfg,
    );
    expect(out.signals.unreadable).toEqual([
      { url: r.url("shop.example", "/terms"), state: "needs_browser" },
      { url: r.url("shop.example", "/legal"), state: "truncated" },
    ]);
    expect(out.ledger.find((e) => e.url.endsWith("/user-agreement"))?.state).toBe("not_found");
    expect(out.docs.find((d) => d.state === "truncated")?.text.length).toBe(1500);
    expect(out.signals.docs_read).toBe(0);
  });

  it("falls back to common paths, at most the configured number of attempts", async () => {
    const { out, r, cfg } = await run(
      { "shop.example": { "/robots.txt": txt(""), "/": { body: page("no links") }, "/terms-of-service": { body: page(policyText("tos")) } } },
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(out.docs.map((d) => new URL(d.url).pathname)).toEqual(["/terms-of-service"]);
    expect(out.signals.unreadable).toEqual([]);
    const tried = r.hits.filter((h) => cfg.discovery.common_paths.includes(h.path));
    expect(tried.length).toBeLessThanOrEqual(cfg.limits.common_path_attempts_max);
  });

  it("uses an input URL on a policy path as the first document", async () => {
    const { out } = await run(
      { "shop.example": { "/robots.txt": txt(""), "/legal/user-agreement": { body: page(policyText("ua")) }, "/": { body: page("x", footer) } } },
      (rr) => ({ url: rr.url("shop.example", "/legal/user-agreement") }),
    );
    expect(out.ledger[1]?.kind).toBe("policy");
    expect(new URL(out.docs[0]?.url ?? "").pathname).toBe("/legal/user-agreement");
  });

  it("records blocked and challenge pages, and stops when robots.txt cannot be read", async () => {
    const challenged = await run(
      {
        "shop.example": {
          "/robots.txt": txt(""),
          "/": { body: "<html><title>Just a moment...</title></html>" },
          "/terms": { status: 403, body: "denied" },
        },
      },
      (rr) => ({ url: rr.url("shop.example", "/terms") }),
    );
    expect(challenged.out.signals.blocked.map((b) => [b.kind, b.status])).toEqual([["policy", 403], ["home", 200]]);
    await s?.close();

    const down = await run({ "shop.example": { "/robots.txt": { status: 500, body: "x" }, "/": { body: page("x", footer) } } }, (rr) => ({
      url: rr.url("shop.example"),
    }));
    expect(down.r.hits.map((h) => h.path)).toEqual(["/robots.txt"]);
    expect(down.out.robots?.state).toBe("error");
    expect(down.out.signals.docs_read).toBe(0);
  });

  it("treats a missing robots.txt as no rules and reports the agent token's own disallow", async () => {
    const none = await run({ "shop.example": { "/": { body: page("x", footer) }, "/terms": { body: page(policyText("t")) } } }, (rr) => ({
      url: rr.url("shop.example"),
    }));
    expect(none.out.robots?.state).toBe("none");
    expect(none.out.signals.docs_read).toBe(1);
    await s?.close();

    const agent = await run({ "shop.example": { "/robots.txt": txt("User-agent: ClaudeBot\nDisallow: /\n") } }, (rr) => ({
      url: rr.url("shop.example", "/p"),
      agent: "ClaudeBot",
    }));
    expect(agent.out.robots?.input_disallowed).toEqual({ izinbot: false, any: false, agent: true });
    await s?.close();

    // IzinBot's own group allows the page, but the "*" group that other agents fall under does not.
    const star = await run({ "shop.example": { "/robots.txt": txt("User-agent: IzinBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n") } }, (rr) => ({
      url: rr.url("shop.example", "/p"),
    }));
    expect(star.out.robots?.input_disallowed).toEqual({ izinbot: false, any: true });
  });

  it("never exceeds the request budget", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `<a href="/terms-${i}">Terms ${i}</a>`).join("");
    const pages = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/terms-${i}`, { body: page(policyText(`t${i}`)) }]));
    const cfg = testConfig({ requests_per_check: 4, policy_docs_max: 3 });
    const { out, r } = await run({ "shop.example": { "/robots.txt": txt(""), "/": { body: page("x", many) }, ...pages } }, (rr) => ({
      url: rr.url("shop.example", "/p"),
    }), cfg);
    expect(r.hits.length).toBe(4);
    expect(out.requests_used).toBe(4);
    expect(out.ledger.filter((e) => e.state === "not_fetched").length).toBeGreaterThan(0);
  });
});
