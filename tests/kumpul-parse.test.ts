// robots.txt groups, Content-Signal, comment documents; HTML extraction; policy discovery.
import { describe, expect, it } from "vitest";
import { parseRobots } from "../server/kumpul/robots.js";
import { extractAnchors, extractText } from "../server/kumpul/extract.js";
import { isPolicyPath, registrableDomain, scoreAnchors } from "../server/kumpul/discover.js";
import { testConfig } from "./helpers/sites.js";

const cfg = testConfig();
const R = "https://shop.example/robots.txt";

// Synthetic text shaped like a store's robots.txt: a long policy comment, a preamble template,
// signals for all agents and a stricter group for one named agent.
const ROBOTS = `# Automated agents, bots and scrapers must not complete checkout or create accounts on this store.
# Buying agents must use the official route described in our terms, and must identify themselves.
# Any other automated purchase is prohibited without written permission. Terms: https://legal.example/terms.

# As a condition of accessing this website, you agree to abide by the following content signals:
# (a) If a Content-Signal = yes, you may collect content for the corresponding use.

User-agent: *
Content-Signal: search=yes, ai-train=no
Disallow: /checkout
Disallow: /account
Crawl-delay: 2

User-agent: GPTBot
User-agent: CCBot
Disallow: /

# short note
User-agent: IzinBot
Content-Signal: ai-input=no
Allow: /
`;

describe("parseRobots", () => {
  const r = parseRobots(R, ROBOTS, cfg);

  it("evaluates disallow for IzinBot, *, and a named agent token", () => {
    expect(r.isDisallowed("https://shop.example/checkout/cart", "SomeBot")).toBe(true);
    expect(r.isDisallowed("https://shop.example/products/1", "SomeBot")).toBe(false);
    expect(r.isDisallowed("https://shop.example/products/1", "GPTBot")).toBe(true);
    expect(r.isDisallowed("https://shop.example/checkout", "IzinBot")).toBe(false);
    expect(r.crawlDelay("SomeBot")).toBe(2);
  });

  it("reads Content-Signal per group with * as fallback", () => {
    expect(r.signals("*")).toEqual({ search: "yes", "ai-train": "no" });
    expect(r.signals("IzinBot")).toEqual({ "ai-input": "no" });
    expect(r.signals("ClaudeBot")).toEqual({ search: "yes", "ai-train": "no" });
  });

  it("turns a long on-topic comment block into a policy document with its URLs", () => {
    const [first, second, third] = r.comments;
    expect(first?.policy).toBe(true);
    expect(first?.urls).toEqual(["https://legal.example/terms"]);
    expect(second?.boilerplate).toBe(true);
    expect(second?.policy).toBe(false);
    expect(third?.policy).toBe(false); // "# short note"
  });

  it("does not treat words that merely contain a short keyword as on topic", () => {
    const text = `# ${"We aim to maintain fair pricing and quick delivery for every customer across the region. ".repeat(4)}`;
    expect(parseRobots(R, text, cfg).comments[0]?.policy).toBe(false);
    expect(parseRobots(R, `${text} AI use is limited.`, cfg).comments[0]?.policy).toBe(true);
  });
});

describe("extractText", () => {
  const html = `<html><body><nav>Menu</nav><main>
    <h1>Terms   of Use</h1><p>Visible clause one.</p>
    <p style="display:none">Hidden note for machines.</p>
    <div hidden>Hidden attribute text.</div><span aria-hidden="true">Aria hidden.</span>
    <script>var x = "script text";</script><style>.a{}</style><noscript>noscript text</noscript>
    <svg><text>svg text</text></svg><iframe src="x"></iframe>
    <h2>Automated access</h2><ul><li>Item A</li><li>Item B</li></ul>
  </main><footer><a href="/privacy">Privacy</a></footer></body></html>`;
  const text = extractText(html);

  it("keeps hidden elements, which are exactly what Izin must see", () => {
    expect(text).toContain("Hidden note for machines.");
    expect(text).toContain("Hidden attribute text.");
    expect(text).toContain("Aria hidden.");
  });

  it("drops script, style, noscript, svg and iframe; marks headings; prefers main", () => {
    for (const gone of ["script text", ".a{}", "noscript text", "svg text", "Menu", "Privacy"]) expect(text).not.toContain(gone);
    expect(text.split("\n")).toEqual([
      "## Terms of Use", "Visible clause one.", "Hidden note for machines.", "Hidden attribute text.", "Aria hidden.",
      "## Automated access", "Item A", "Item B",
    ]);
  });

  it("falls back to article, then body", () => {
    expect(extractText("<body><p>x</p><article><p>only this</p></article></body>")).toBe("only this");
    expect(extractText("<body><p>body text</p></body>")).toBe("body text");
  });

  it("collects anchors from the whole page, resolved and without fragments", () => {
    expect(extractAnchors(html, "https://shop.example/a/b")).toEqual([{ href: "https://shop.example/privacy", text: "Privacy" }]);
    expect(extractAnchors('<a href="mailto:x@y.z">m</a><a href="/t#s">T</a>', "https://s.example/")).toEqual([
      { href: "https://s.example/t", text: "T" },
    ]);
  });
});

describe("discovery", () => {
  it("computes registrable domains with multi-part suffixes from config", () => {
    expect(registrableDomain("www.shop.example", cfg)).toBe("shop.example");
    expect(registrableDomain("shop.app", cfg)).toBe("shop.app");
    expect(registrableDomain("pages.store.co.uk", cfg)).toBe("store.co.uk");
    expect(registrableDomain("a.b.store.com.my", cfg)).toBe("store.com.my");
  });

  it("recognises policy paths on the input URL", () => {
    expect(isPolicyPath(new URL("https://s.example/legal/user-agreement"), cfg)).toBe(true);
    expect(isPolicyPath(new URL("https://s.example/products/42"), cfg)).toBe(false);
  });

  it("scores links, drops privacy/cookie and other sites, input page first on a tie", () => {
    const got = scoreAnchors(
      [
        { from: "input", anchors: [{ href: "https://shop.example/help/conditions", text: "Conditions" }] },
        {
          from: "home",
          anchors: [
            { href: "https://shop.example/terms", text: "Terms" },
            { href: "https://shop.example/privacy", text: "Privacy policy" },
            { href: "https://shop.example/cookies", text: "Cookie terms" },
            { href: "https://help.shop.example/api-terms", text: "API terms and conditions" },
            { href: "https://other.example/terms", text: "Terms" },
            { href: "https://shop.example/about", text: "About us" },
          ],
        },
      ],
      "shop.example",
      cfg,
    );
    expect(got.map((c) => c.url)).toEqual([
      "https://help.shop.example/api-terms",
      "https://shop.example/help/conditions",
      "https://shop.example/terms",
    ]);
  });
});
