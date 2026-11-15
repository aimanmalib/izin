// Stop at robots.txt: when robots.txt itself forbids the action for automated clients, the collector
// makes one request and the receipt says "robots.txt only". Synthetic robots files, no outside network.
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { collect } from "../server/kumpul/collect.js";
import { forbiddingSentence, sentences } from "../server/kumpul/stop.js";
import { runCheck, type CheckInput } from "../server/pipeline.js";
import { ReceiptStore } from "../server/resit/store.js";
import { pipelineDeps } from "../server/wiring.js";
import type { Action } from "../server/config.js";
import en from "../lang/en.json" with { type: "json" };
import { page, policyText, startSites, testConfig, type Running, type Sites } from "./helpers/sites.js";

let s: Running | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const cfg = testConfig();
const txt = (body: string) => ({ type: "text/plain", body });
const footer = '<a href="/terms">Terms of Service</a>';

// Site-wide ban in the style many robots.txt files carry above their rules.
const strict =
  "# NOTICE: The use of robots, spiders or other automated means to access this site without express written permission\n" +
  "# is strictly prohibited. Requests from unidentified clients may be refused. Contact the site team to ask for permission\n" +
  "# before you run any tool against these pages.";
// A ban scoped to one action: buying agents. Reading pages stays governed by the directives below it.
const checkoutOnly =
  "# Agent policy for this store. Checkouts are strictly for human users. Automated agents that buy on behalf of a person\n" +
  "# are strictly prohibited from placing orders. Approved integrations must use the official API described in our terms\n" +
  "# and identify themselves with a stable user agent.";
// An ordinary policy comment: it asks for identification and names the terms, but forbids nothing.
const ordinary =
  "# Hello automated agents and bots. Please identify your crawler with a contact URL and keep to one request per second.\n" +
  "# Our terms of service describe how the content may be reused, and we are happy to talk about access for research.";

const site = (robots: string): Sites => ({
  "shop.example": {
    "/robots.txt": txt(robots),
    "/": { body: page("<h1>Shop</h1>", footer) },
    "/terms": { body: page(policyText("terms")) },
    "/item/1": { body: page("<h1>Item</h1>", footer) },
  },
});

async function collected(robots: string, action: Action, path = "/item/1") {
  const r = (s = await startSites(site(robots)));
  const out = await collect({ url: r.url("shop.example", path), action }, { cfg, policy: r.policy });
  return { out, r };
}

describe("forbidding sentence", () => {
  it("joins line breaks inside a sentence and splits on sentence ends", () => {
    expect(sentences("One rule\ncontinues here. Two; three!")).toEqual(["One rule continues here.", "Two;", "three!"]);
  });

  it("a site-wide ban without permission applies to every action", () => {
    const text = strict.replace(/^# ?/gm, "");
    for (const a of cfg.actions) expect(forbiddingSentence(text, a, cfg)).toMatch(/strictly prohibited\.$/);
  });

  it("an action-scoped ban stops only that action", () => {
    const text = checkoutOnly.replace(/^# ?/gm, "");
    expect(forbiddingSentence(text, "purchase", cfg)).toBe("Checkouts are strictly for human users.");
    expect(forbiddingSentence(text, "read_page", cfg)).toBeNull();
    expect(forbiddingSentence(text, "crawl", cfg)).toBeNull();
  });

  it("an ordinary comment, or a ban not aimed at automated clients, stops nothing", () => {
    for (const a of cfg.actions) expect(forbiddingSentence(ordinary.replace(/^# ?/gm, ""), a, cfg)).toBeNull();
    expect(forbiddingSentence("Reselling tickets bought here is prohibited without written permission.", "purchase", cfg)).toBeNull();
    // "robots.txt" is a file name, not an address to robots.
    expect(forbiddingSentence("Copying robots.txt is prohibited without permission.", "crawl", cfg)).toBeNull();
  });
});

describe("collector stops at robots.txt", () => {
  it("a comment that forbids the action: one request, nothing else fetched", async () => {
    const { out, r } = await collected(`${strict}\nUser-agent: *\nAllow: /\n`, "read_page");
    expect(r.hits.map((h) => h.path)).toEqual(["/robots.txt"]);
    expect(out.requests_used).toBe(1);
    expect(out.signals.robots_stop).toEqual({ by: "comment", sentence: expect.stringMatching(/strictly prohibited\.$/) });
    expect(out.docs.map((d) => d.kind)).toEqual(["robots_comments"]);
  });

  it("an action-scoped comment stops purchase but not read_page", async () => {
    const robots = `${checkoutOnly}\nUser-agent: *\nAllow: /\n`;
    const buy = await collected(robots, "purchase");
    expect(buy.r.hits.map((h) => h.path)).toEqual(["/robots.txt"]);
    expect(buy.out.signals.robots_stop?.by).toBe("comment");
    await s?.close();
    const read = await collected(robots, "read_page");
    expect(read.out.signals.robots_stop).toBeNull();
    expect(read.r.hits.map((h) => h.path)).toEqual(["/robots.txt", "/item/1", "/", "/terms"]);
  });

  it("an ordinary comment: normal discovery", async () => {
    const { out, r } = await collected(`${ordinary}\nUser-agent: *\nAllow: /\n`, "crawl");
    expect(out.signals.robots_stop).toBeNull();
    expect(r.hits.length).toBeGreaterThan(1);
  });

  it("a Disallow covering the URL stops crawl (configured actions) but not read_page", async () => {
    const robots = "User-agent: *\nDisallow: /item/\n";
    const crawl = await collected(robots, "crawl");
    expect(crawl.out.signals.robots_stop).toEqual({ by: "directive" });
    expect(crawl.out.requests_used).toBe(1);
    await s?.close();
    const read = await collected(robots, "read_page");
    expect(read.out.signals.robots_stop).toBeNull();
    expect(read.r.hits.some((h) => h.path === "/terms")).toBe(true);
  });

  it("without an action the collector never stops early", async () => {
    const r = (s = await startSites(site(`${strict}\nUser-agent: *\nAllow: /\n`)));
    const out = await collect({ url: r.url("shop.example", "/item/1") }, { cfg, policy: r.policy });
    expect(out.signals.robots_stop).toBeNull();
    expect(r.hits.length).toBeGreaterThan(1);
  });
});

describe("receipt", () => {
  async function check(robots: string, input: (r: Running) => CheckInput) {
    const r = (s = await startSites(site(robots)));
    const deps = { ...pipelineDeps(cfg, { env: { IZIN_FAKE: "1" } }), policy: r.policy, store: new ReceiptStore(new Database(":memory:")), sleep: async () => {} };
    return runCheck(input(r), deps);
  }

  it("records fetched: robots.txt only, with the sentence, and a ledger of one line", async () => {
    const receipt = await check(`${checkoutOnly}\nUser-agent: *\nAllow: /\n`, (r) => ({ url: r.url("shop.example", "/item/1"), action: "purchase" }));
    expect(receipt.fetched).toEqual({ scope: "robots_only", label: "robots.txt only" });
    expect(receipt.signals.robots_stop?.sentence).toBe("Checkouts are strictly for human users.");
    expect(receipt.fetch_ledger.map((e) => e.kind)).toEqual(["robots"]);
    // The terms were not read on purpose, so silence cannot become GO.
    expect(receipt.verdict).not.toBe("GO");
    expect(receipt.decided_by.ceilings).toContain("S5");
    // The decision step's line and the code's line for the same URL are one line, the state in words.
    expect(receipt.missing).toEqual([`${receipt.url} (${en.receipt.unreadable_why.stopped_at_robots_txt})`]);
  });

  it("a crawl the robots rules disallow is NO_GO from robots.txt alone", async () => {
    const receipt = await check("User-agent: *\nDisallow: /\n", (r) => ({ url: r.url("shop.example", "/"), action: "crawl" }));
    expect(receipt.verdict).toBe("NO_GO");
    expect(receipt.fetched.scope).toBe("robots_only");
    expect(receipt.signals.robots_stop).toEqual({ by: "directive" });
  });

  it("an ordinary check records the pages it fetched", async () => {
    const receipt = await check("User-agent: *\nAllow: /\n", (r) => ({ url: r.url("shop.example", "/item/1"), action: "read_page" }));
    expect(receipt.fetched).toEqual({ scope: "pages", label: "robots.txt and the site's pages" });
    expect(receipt.signals.robots_stop).toBeNull();
  });
});
