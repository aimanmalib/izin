// Readability classification and gallery pick, against synthetic sites on a local server.
import { afterEach, describe, expect, it } from "vitest";
import { collect } from "../server/kumpul/collect.js";
import { classify, pickGallery, type ReadabilitySite } from "../server/galeri/readability.js";
import { parseConfig } from "../server/config.js";
import { page, policyText, startSites, testConfig, type Running, type Sites } from "./helpers/sites.js";

let s: Running | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const footer = '<a href="/terms">Terms of Service</a>';

async function classifyHost(sites: Sites, host: string, cfg = testConfig()) {
  const r = (s = await startSites(sites));
  const out = await collect({ url: r.url(host) }, { cfg, policy: r.policy });
  return { site: classify({ host, group: "shopping" }, out), r };
}

describe("classify", () => {
  it("marks a site readable when a policy page is read, and keeps only its URL", async () => {
    const { site, r } = await classifyHost(
      {
        "shop.example": {
          "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
          "/": { body: page("<h1>Shop</h1>", footer) },
          "/terms": { body: page(policyText("terms")) },
        },
      },
      "shop.example",
    );
    expect(site).toMatchObject({ readable: true, reason: "read", robots_status: "ok", robots_http: 200, docs_read: 1 });
    expect(site.read_urls).toEqual([r.url("shop.example", "/terms")]);
    expect(JSON.stringify(site)).not.toContain("Section on");
  });

  it("reports a 403 on every page as blocked, with the status, and does not retry", async () => {
    const wall = { status: 403, body: "Access denied" };
    const { site, r } = await classifyHost(
      { "wall.example": { "/robots.txt": wall, "/": wall, "/terms": wall } },
      "wall.example",
    );
    expect(site).toMatchObject({ readable: false, reason: "blocked", blocked_status: 403 });
    expect(r.hits.filter((h) => h.path === "/").length).toBeLessThanOrEqual(1);
  });

  it("reports a site whose robots.txt disallows IzinBot everywhere as robots_disallow", async () => {
    const { site } = await classifyHost(
      {
        "closed.example": {
          "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" },
          "/": { body: page("<h1>Shop</h1>", footer) },
          "/terms": { body: page(policyText("terms")) },
        },
      },
      "closed.example",
    );
    expect(site).toMatchObject({ readable: false, reason: "robots_disallow" });
  });

  it("reports a short script shell as needs_browser and a site with no terms as no_policy_found", async () => {
    const shell = await classifyHost(
      { "app.example": { "/": { body: page("<h1>Shop</h1>", footer) }, "/terms": { body: page("<div id=root></div>") } } },
      "app.example",
    );
    expect(shell.site).toMatchObject({ readable: false, reason: "needs_browser", robots_status: "none" });
    await s?.close();
    const bare = await classifyHost({ "bare.example": { "/": { body: page("<p>hello</p>") } } }, "bare.example");
    expect(bare.site).toMatchObject({ readable: false, reason: "no_policy_found" });
  });

  it("counts policy comments in robots.txt as readable, with their own reason", async () => {
    const note = "# Automated agents must not create accounts or post on this service. Any automated access requires our written permission first, as set out in our published terms for all users.\n# Contact the operator before running any agent against checkout, sign-up or posting pages.";
    const { site } = await classifyHost(
      { "notes.example": { "/robots.txt": { type: "text/plain", body: `${note}\nUser-agent: *\nAllow: /\n` }, "/": { body: page("<p>hello</p>") } } },
      "notes.example",
    );
    expect(site).toMatchObject({ readable: true, reason: "robots_comments", docs_read: 1, read_urls: [] });
  });

  it("keeps a site readable from its robots.txt comments when its pages answer 403, and records the block", async () => {
    const note = "# Automated agents must not buy, bid or create accounts on this marketplace without our express written permission.\n# Any automated access to checkout pages is prohibited and may be blocked without notice.";
    const wall = { status: 403, body: "Access denied" };
    const { site } = await classifyHost(
      { "market.example": { "/robots.txt": { type: "text/plain", body: `${note}\nUser-agent: *\nAllow: /\n` }, "/": wall, "/terms": wall } },
      "market.example",
    );
    expect(site).toMatchObject({ readable: true, reason: "robots_comments", blocked_status: 403, read_urls: [] });
  });

  it("never fetches a do-not-fetch host", async () => {
    const base = testConfig();
    const cfg = parseConfig({ ...base, do_not_fetch_hosts: [...base.do_not_fetch_hosts, "radar.example"] });
    const { site, r } = await classifyHost({ "radar.example": { "/": { body: page("<h1>Shop</h1>", footer) } } }, "radar.example", cfg);
    expect(site).toMatchObject({ readable: false, reason: "do_not_fetch", requests: 0 });
    expect(r.hits).toHaveLength(0);
  });
});

describe("pickGallery", () => {
  const mk = (host: string, readable: boolean, extra: Partial<ReadabilitySite> = {}): ReadabilitySite => ({
    host,
    readable,
    reason: readable ? "read" : "blocked",
    robots_status: "ok",
    robots_http: 200,
    docs_read: readable ? 1 : 0,
    requests: 3,
    read_urls: readable ? [`https://${host}/terms`] : [],
    ...extra,
  });

  it("keeps candidate order, caps the size, and lists every unreadable site separately", () => {
    const cands = ["a.example", "b.example", "c.example", "d.example", "e.example"].map((host) => ({ host }));
    const results = [
      mk("e.example", true),
      mk("b.example", false, { blocked_status: 403 }),
      mk("a.example", true),
      mk("c.example", true),
      mk("d.example", false, { reason: "do_not_fetch" }),
    ];
    const g = pickGallery(cands, results, 2);
    expect(g.sites.map((x) => x.host)).toEqual(["a.example", "c.example"]);
    expect(g.sites[0]!.policy_hints).toEqual(["https://a.example/terms"]);
    expect(g.blocked_reader).toEqual([{ host: "b.example", reason: "blocked", status: 403 }]);
  });
});
