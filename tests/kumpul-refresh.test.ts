// HTML meta refresh (ADR 0025): a short page that sends its visitors on gives way to its target,
// which passes the same checks as any other page. Synthetic sites; no outside network.
import { afterEach, describe, expect, it } from "vitest";
import { collect, type CollectInput } from "../server/kumpul/collect.js";
import { metaRefresh, refreshTarget } from "../server/kumpul/refresh.js";
import type { IzinConfig } from "../server/config.js";
import { page, policyText, startSites, testConfig, type Running, type Sites } from "./helpers/sites.js";

let s: Running | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

async function run(def: Sites | ((url: Running["url"]) => Sites), input: (r: Running) => CollectInput, cfg: IzinConfig = testConfig()) {
  const r = (s = await startSites(def));
  const out = await collect(input(r), { cfg, policy: r.policy });
  const paths = (host: string) => r.hits.filter((h) => h.host === host).map((h) => h.path);
  return { out, r, paths };
}

const txt = (body: string) => ({ type: "text/plain", body });
/** A page with nothing on it but a refresh. */
const stub = (target: string, seconds = 0) => ({
  body: `<html><head><meta http-equiv="refresh" content="${seconds}; url=${target}"></head><body></body></html>`,
});
/** The shape measured on one large site: the refresh sits in <noscript>, next to a link and a script that does the same. */
const noscriptStub = (target: string) => ({
  body: `<!DOCTYPE html>\n<title></title><noscript>\n<meta content="0; URL=${target}" http-equiv="refresh"></noscript>\n<a href="${target}" id="link">${target}</a>\n<script>window.location.href="${target}";</script>`,
});
const docsOf = (out: { docs: { url: string; state: string }[] }) => out.docs.map((d) => [new URL(d.url).hostname + new URL(d.url).pathname, d.state]);

describe("metaRefresh", () => {
  const base = "https://www.shop.example/intl/en/terms/";
  it.each([
    ['<meta content="0; URL=https://policies.shop.example/terms" http-equiv="refresh">', 0, "https://policies.shop.example/terms"],
    ["<META HTTP-EQUIV=\"Refresh\" CONTENT=\"3;url='/b'\">", 3, "https://www.shop.example/b"],
    ['<meta http-equiv=refresh content="0, ../c#part">', 0, "https://www.shop.example/intl/en/c"],
    ['<meta http-equiv="refresh" content=" 2.5 ; url = &quot;d&quot; ">', 2, "https://www.shop.example/intl/en/terms/d"],
    ['<meta http-equiv="refresh" content="30"><meta http-equiv="refresh" content="1;/e">', 1, "https://www.shop.example/e"],
    // IzinBot runs no scripts, so the branch a page writes for such clients is the one it follows.
    ['<title></title><noscript>\n<meta content="0; URL=/f" http-equiv="refresh"></noscript>', 0, "https://www.shop.example/f"],
  ])("%s", (html, seconds, url) => {
    expect(metaRefresh(`<html><head>${html}</head><body>x</body></html>`, base)).toEqual({ seconds, url });
  });

  it.each([
    '<meta http-equiv="refresh" content="5">',
    '<meta http-equiv="refresh" content="soon; url=/b">',
    '<meta http-equiv="refresh" content="0; url=javascript:alert(1)">',
    '<meta http-equiv="content-type" content="0; url=/b">',
    '<script>document.write(\'<meta http-equiv="refresh" content="0; url=/written-by-script">\')</script>',
    "<p>Set http-equiv=refresh to send visitors on.</p>",
  ])("no target in %s", (html) => {
    expect(metaRefresh(`<html><head>${html}</head><body>x</body></html>`, base)).toBeNull();
  });
});

describe("refreshTarget", () => {
  const cfg = testConfig();
  const to = (target: string, seconds = 0, from = "https://www.shop.co.uk/terms") =>
    refreshTarget(`<meta http-equiv="refresh" content="${seconds}; url=${target}">`, from, cfg);

  it("keeps to the page's own registrable domain and to the configured wait", () => {
    expect(to("https://legal.shop.co.uk/terms")).toBe("https://legal.shop.co.uk/terms");
    expect(to("https://other.co.uk/terms")).toBeNull();
    expect(to("https://shop.co.uk.other.example/terms")).toBeNull();
    expect(to("/real", cfg.limits.meta_refresh_max_seconds)).toBe("https://www.shop.co.uk/real");
    expect(to("/real", cfg.limits.meta_refresh_max_seconds + 1)).toBeNull();
  });

  it("never names the page itself, and an address matches itself and nothing else", () => {
    expect(to("/terms#top")).toBeNull();
    expect(to("http://93.184.216.34/b", 0, "http://93.184.216.34/a")).toBe("http://93.184.216.34/b");
    expect(to("http://10.0.216.34/b", 0, "http://93.184.216.34/a")).toBeNull();
  });
});

describe("collect follows a meta refresh", () => {
  it("reads the target of a stub in its place, after the target host's robots.txt", async () => {
    const { out, r } = await run(
      (url) => ({
        "www.shop.example": {
          "/robots.txt": txt(""),
          "/": { body: page("Home") },
          "/intl/en/policies/terms/": noscriptStub(url("policies.shop.example", "/terms")),
        },
        "policies.shop.example": { "/robots.txt": txt("User-agent: *\nDisallow: /private\n"), "/terms": { body: page(policyText("terms")) } },
      }),
      (rr) => ({ url: rr.url("www.shop.example", "/intl/en/policies/terms/") }),
    );
    expect(docsOf(out)).toEqual([["policies.shop.example/terms", "ok"]]);
    expect(out.docs[0]?.text).toContain("Section on terms.");
    expect(out.signals).toMatchObject({ docs_read: 1, unreadable: [], blocked: [] });
    // The ledger keeps the stub and the target; the target host's robots.txt comes before its page.
    expect(out.ledger.map((e) => [new URL(e.url).hostname.split(".")[0], e.kind, e.state, e.note])).toEqual([
      ["www", "robots", "ok", undefined],
      ["www", "policy", "ok", "meta refresh"],
      ["policies", "robots", "ok", undefined],
      ["policies", "policy", "ok", undefined],
      ["www", "home", "ok", undefined],
    ]);
    expect(r.hits.map((h) => h.path)).toEqual(["/robots.txt", "/intl/en/policies/terms/", "/robots.txt", "/terms", "/"]);
    expect(out.requests_used).toBe(5);
  });

  it("follows on the home page and on a linked policy page, but not to another registrable domain", async () => {
    const { out, r, paths } = await run(
      (url) => ({
        "shop.example": {
          "/robots.txt": txt(""),
          "/": stub("/en/"),
          "/en/": { body: page("Home", '<a href="/terms">Terms</a> <a href="/legal">Legal</a>') },
          "/terms": stub("/terms/current"),
          "/terms/current": { body: page(policyText("current terms")) },
          "/legal": stub(url("other.example", "/legal")),
        },
        "other.example": { "/robots.txt": txt(""), "/legal": { body: page(policyText("someone else")) } },
      }),
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(docsOf(out)).toEqual([["shop.example/terms/current", "ok"], ["shop.example/legal", "needs_browser"]]);
    expect(out.signals.unreadable).toEqual([{ url: r.url("shop.example", "/legal"), state: "needs_browser" }]);
    expect(out.ledger.map((e) => e.kind)).toEqual(["robots", "home", "home", "policy", "policy", "policy"]);
    expect(paths("other.example")).toEqual([]);
  });

  it("does not fetch a target that robots.txt disallows: the stub stands as before", async () => {
    const { out, r, paths } = await run(
      {
        "shop.example": {
          "/robots.txt": txt("User-agent: IzinBot\nDisallow: /members/\n"),
          "/": { body: page("Home") },
          "/terms": stub("/members/terms"),
          "/members/terms": { body: page(policyText("members")) },
        },
      },
      (rr) => ({ url: rr.url("shop.example", "/terms") }),
    );
    expect(paths("shop.example")).toEqual(["/robots.txt", "/terms", "/"]);
    expect(docsOf(out)).toEqual([["shop.example/terms", "needs_browser"]]);
    expect(out.signals.unreadable).toEqual([{ url: r.url("shop.example", "/terms"), state: "needs_browser" }]);
    expect(out.ledger.find((e) => e.url.endsWith("/members/terms"))).toMatchObject({ kind: "policy", state: "robots_disallow", bytes: 0 });
  });

  it("holds the hop limit from config, and zero hops turns following off", async () => {
    const sites: Sites = {
      "shop.example": {
        "/robots.txt": txt(""),
        "/": { body: page("Home") },
        "/terms": stub("/terms/2"),
        "/terms/2": stub("/terms/3"),
        "/terms/3": { body: page(policyText("third")) },
      },
    };
    const input = (rr: Running) => ({ url: rr.url("shop.example", "/terms") });

    const one = await run(sites, input);
    expect(testConfig().limits.meta_refresh_hops).toBe(1);
    expect(docsOf(one.out)).toEqual([["shop.example/terms/2", "needs_browser"]]);
    expect(one.out.signals.unreadable).toEqual([{ url: one.r.url("shop.example", "/terms/2"), state: "needs_browser" }]);
    expect(one.paths("shop.example")).toEqual(["/robots.txt", "/terms", "/terms/2", "/"]);
    await s?.close();

    const two = await run(sites, input, testConfig({ meta_refresh_hops: 2 }));
    expect(docsOf(two.out)).toEqual([["shop.example/terms/3", "ok"]]);
    await s?.close();

    const off = await run(sites, input, testConfig({ meta_refresh_hops: 0 }));
    expect(docsOf(off.out)).toEqual([["shop.example/terms", "needs_browser"]]);
    expect(off.paths("shop.example")).toEqual(["/robots.txt", "/terms", "/"]);
  });

  it("leaves the stub standing when the request budget is spent, and counts the target against the budget", async () => {
    const sites: Sites = {
      "shop.example": { "/robots.txt": txt(""), "/": { body: page("Home") }, "/terms": stub("/terms/current"), "/terms/current": { body: page(policyText("t")) } },
    };
    const input = (rr: Running) => ({ url: rr.url("shop.example", "/terms") });

    const spent = await run(sites, input, testConfig({ requests_per_check: 2, policy_docs_max: 1 }));
    expect(spent.paths("shop.example")).toEqual(["/robots.txt", "/terms"]);
    expect(docsOf(spent.out)).toEqual([["shop.example/terms", "needs_browser"]]);
    expect(spent.out.ledger.find((e) => e.url.endsWith("/terms/current"))).toMatchObject({ state: "not_fetched", note: "request budget" });
    await s?.close();

    const enough = await run(sites, input, testConfig({ requests_per_check: 3, policy_docs_max: 1 }));
    expect(enough.paths("shop.example")).toEqual(["/robots.txt", "/terms", "/terms/current"]);
    expect(docsOf(enough.out)).toEqual([["shop.example/terms/current", "ok"]]);
    expect(enough.out.requests_used).toBe(3);
  });

  it("ignores a refresh on a page with enough text, a long wait, a loop, and a page already fetched", async () => {
    const withText = `<html><head><meta http-equiv="refresh" content="0; url=/elsewhere"></head><body>${policyText("kept")}</body></html>`;
    const { out, paths } = await run(
      {
        "shop.example": {
          "/robots.txt": txt(""),
          "/": { body: page("Home", '<a href="/terms">Terms</a> <a href="/legal">Legal</a> <a href="/tos">Terms of service</a> <a href="/conditions">Conditions</a>') },
          "/terms": { body: withText },
          "/legal": stub("/later", 30),
          "/tos": stub("/tos"),
          "/conditions": stub("/"),
          "/elsewhere": { body: page(policyText("elsewhere")) },
          "/later": { body: page(policyText("later")) },
        },
      },
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(docsOf(out)).toEqual([
      ["shop.example/terms", "ok"],
      ["shop.example/legal", "needs_browser"],
      ["shop.example/tos", "needs_browser"],
      ["shop.example/conditions", "needs_browser"],
    ]);
    expect(paths("shop.example")).toEqual(["/robots.txt", "/", "/terms", "/legal", "/tos", "/conditions"]);
  });

  it("reports what the target answered once it was requested, and does not read a target twice", async () => {
    const { out, r, paths } = await run(
      {
        "shop.example": {
          "/robots.txt": txt(""),
          "/": { body: page("Home", '<a href="/terms">Terms</a> <a href="/terms/current">Current terms</a> <a href="/legal">Legal</a>') },
          "/terms": stub("/terms/current"),
          "/terms/current": { body: page(policyText("current")) },
          "/legal": stub("/legal/blocked"),
          "/legal/blocked": { status: 403, body: "denied" },
        },
      },
      (rr) => ({ url: rr.url("shop.example") }),
    );
    expect(docsOf(out)).toEqual([["shop.example/terms/current", "ok"]]);
    expect(paths("shop.example").filter((p) => p === "/terms/current").length).toBe(1);
    expect(out.signals.blocked).toEqual([{ url: r.url("shop.example", "/legal/blocked"), kind: "policy", status: 403 }]);
    expect(out.signals.unreadable).toEqual([{ url: r.url("shop.example", "/legal/blocked"), state: "blocked" }]);
  });
});
