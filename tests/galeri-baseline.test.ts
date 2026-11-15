// Robots-only baseline (ADR 0010): what robots.txt alone answers per pair, and the headline count of
// pairs it allows while a quoted clause from the site restricts the action. Synthetic receipts only.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { benchView, galleryView } from "../server/api/views.js";
import type { Stance, Verdict } from "../server/config.js";
import type { CeilingCode } from "../server/putus/siling.js";
import { baselineCell, baselineCounts, decidedBy, robotsOnly, wordsRestrict, type BaselineReceipt } from "../server/galeri/baseline.js";
import { baselineSection, galleryNowCounts, galleryNowSection, replaceSection, type GalleryNowRow } from "../server/galeri/ukur.js";
import { openDb, ReceiptStore } from "../server/resit/store.js";

const RESTRICT: Stance[] = ["prohibits", "restricts", "requires"];

function receipt(o: {
  fetched?: boolean;
  disallowed?: boolean;
  verdict: Verdict;
  serv?: Verdict | null;
  ceilings?: CeilingCode[];
  flags?: string[];
  clauses?: [string, boolean][];
}): BaselineReceipt {
  return {
    verdict: o.verdict,
    decided_by: { serv_verdict: o.serv === undefined ? o.verdict : o.serv, ceilings: o.ceilings ?? [], flags: (o.flags ?? []) as BaselineReceipt["decided_by"]["flags"] },
    signals: { robots: { fetched: o.fetched ?? true, disallow_for_agent: o.disallowed ?? false, crawl_delay: null, content_signal: {} } },
    clauses: (o.clauses ?? []).map(([stance, decisive], i) => ({
      id: `c${i}`,
      doc: "d1",
      section: "s",
      category: "automated_access",
      stance,
      quote: "synthetic clause text for the test",
      source_url: "https://shop.example/terms",
      fragment_url: null,
      decisive,
    })),
  };
}

describe("robots-only answer", () => {
  it("is allowed, disallowed or no_robots from the stored robots signals", () => {
    expect(robotsOnly(receipt({ verdict: "GO" }))).toBe("allowed");
    expect(robotsOnly(receipt({ verdict: "NO_GO", disallowed: true }))).toBe("disallowed");
    expect(robotsOnly(receipt({ verdict: "ASK", fetched: false }))).toBe("no_robots");
  });
});

describe("headline count: robots allows, the site's words restrict", () => {
  it("counts an allowed pair with a decisive prohibiting clause and NO-GO", () => {
    expect(wordsRestrict(receipt({ verdict: "NO_GO", clauses: [["prohibits", true]] }), RESTRICT)).toBe(true);
  });
  it("counts an allowed pair with a decisive restricting or requiring clause and ASK", () => {
    expect(wordsRestrict(receipt({ verdict: "ASK", clauses: [["restricts", true]] }), RESTRICT)).toBe(true);
    expect(wordsRestrict(receipt({ verdict: "ASK", clauses: [["requires", true]] }), RESTRICT)).toBe(true);
  });
  it("does not count an ASK that comes from a failure (no decisive clause)", () => {
    expect(wordsRestrict(receipt({ verdict: "ASK" }), RESTRICT)).toBe(false);
    expect(wordsRestrict(receipt({ verdict: "ASK", clauses: [["prohibits", false]] }), RESTRICT)).toBe(false);
  });
  it("does not count a failure ASK even when it carries a decisive restricting clause", () => {
    // Decider unavailable or guard tripped: no decider verdict, the code caps at ASK.
    expect(wordsRestrict(receipt({ verdict: "ASK", serv: null, ceilings: ["S8"], clauses: [["requires", true]] }), RESTRICT)).toBe(false);
  });
  it("does not count a decider GO lowered to ASK by a code ceiling (S5, S6)", () => {
    const lowered = (c: CeilingCode, stance: string) =>
      wordsRestrict(receipt({ verdict: "ASK", serv: "GO", ceilings: [c], clauses: [[stance, true]] }), RESTRICT);
    expect(lowered("S5", "requires")).toBe(false);
    expect(lowered("S5", "restricts")).toBe(false);
    expect(lowered("S6", "prohibits")).toBe(false);
  });
  it("counts a decider NO-GO that a ceiling turned into ASK, when it rests on a restricting clause", () => {
    expect(wordsRestrict(receipt({ verdict: "ASK", serv: "NO_GO", ceilings: ["S7"], clauses: [["restricts", true]] }), RESTRICT)).toBe(true);
  });
  it("does not count a pair robots.txt disallows, or one with no robots.txt", () => {
    expect(wordsRestrict(receipt({ verdict: "NO_GO", disallowed: true, clauses: [["prohibits", true]] }), RESTRICT)).toBe(false);
    expect(wordsRestrict(receipt({ verdict: "NO_GO", fetched: false, clauses: [["prohibits", true]] }), RESTRICT)).toBe(false);
  });
  it("does not count GO, or an ASK resting on a permitting or unclear clause", () => {
    expect(wordsRestrict(receipt({ verdict: "GO", clauses: [["restricts", true]] }), RESTRICT)).toBe(false);
    expect(wordsRestrict(receipt({ verdict: "ASK", clauses: [["permits", true], ["unclear", true]] }), RESTRICT)).toBe(false);
  });
  it("takes the restricting stances from config", () => {
    expect(wordsRestrict(receipt({ verdict: "ASK", clauses: [["requires", true]] }), ["prohibits"])).toBe(false);
  });
  it("adds the cells up", () => {
    const cells = [
      receipt({ verdict: "NO_GO", clauses: [["prohibits", true]] }),
      receipt({ verdict: "ASK" }),
      receipt({ verdict: "GO" }),
      receipt({ verdict: "NO_GO", disallowed: true, clauses: [["prohibits", true]] }),
      receipt({ verdict: "ASK", fetched: false }),
    ].map((r) => baselineCell(r, RESTRICT));
    expect(baselineCounts(cells)).toEqual({
      pairs: 5, allowed: 3, disallowed: 1, no_robots: 1, robots_allowed_words_restrict: 1, decided: 5, decided_allowed: 3, decided_allowed_words_restrict: 1,
    });
  });
});

describe("how a pair was decided", () => {
  const by = (o: Parameters<typeof receipt>[0]) => decidedBy(receipt(o).decided_by);
  it("is decider when the decision step gave a valid answer", () => {
    expect(by({ verdict: "NO_GO" })).toBe("decider");
    expect(by({ verdict: "ASK", serv: "GO", ceilings: ["S5"] })).toBe("decider");
  });
  it("is code when the code decided without calling the decision step", () => {
    expect(by({ verdict: "ASK", serv: null, ceilings: ["S11"], flags: ["decider_skipped"] })).toBe("code");
  });
  it("is none when no valid decision came back (unavailable, or ceiling S8)", () => {
    expect(by({ verdict: "ASK", serv: null, flags: ["decider_unavailable"] })).toBe("none");
    expect(by({ verdict: "ASK", serv: "GO", ceilings: ["S8"] })).toBe("none");
  });
  it("counts only pairs the decision step answered in the decided line", () => {
    const cells = [
      receipt({ verdict: "NO_GO", clauses: [["prohibits", true]] }),
      receipt({ verdict: "ASK", serv: null, flags: ["decider_unavailable"] }),
      receipt({ verdict: "ASK", serv: null, ceilings: ["S11"], flags: ["decider_skipped"] }),
      receipt({ verdict: "NO_GO", disallowed: true, clauses: [["prohibits", true]] }),
    ].map((r) => baselineCell(r, RESTRICT));
    expect(cells.map((c) => c.decided)).toEqual(["decider", "none", "code", "decider"]);
    expect(baselineCounts(cells)).toMatchObject({ pairs: 4, allowed: 3, decided: 2, decided_allowed: 1, decided_allowed_words_restrict: 1 });
  });
  it("marks each gallery cell and writes the decided line into UKUR", () => {
    const dir = mkdtempSync(join(tmpdir(), "izin-decided-"));
    const path = join(dir, "gallery.json");
    writeFileSync(path, JSON.stringify({ sites: [{ host: "shop.example", group: "shopping" }], blocked_reader: [] }));
    const db = new ReceiptStore(openDb(":memory:")).db;
    const put = (id: string, action: string, r: BaselineReceipt) => {
      db.prepare(`INSERT INTO checks (id, created_at, site, url, action, source, status, verdict, receipt_json) VALUES (?, '2026-11-10', 'shop.example', 'https://shop.example/', ?, 'gallery', 'done', ?, ?)`).run(id, action, r.verdict, JSON.stringify(r));
      db.prepare("INSERT INTO gallery (site, action, check_id, updated_at) VALUES ('shop.example', ?, ?, '2026-11-10')").run(action, id);
    };
    put("aaaaaaaaaa", "purchase", receipt({ verdict: "NO_GO", clauses: [["prohibits", true]] }));
    put("bbbbbbbbbb", "crawl", receipt({ verdict: "ASK", serv: null, flags: ["decider_unavailable"] }));
    put("cccccccccc", "post", receipt({ verdict: "ASK", serv: null, ceilings: ["S11"], flags: ["decider_skipped"] }));
    const v = galleryView(db, RESTRICT, path);
    rmSync(dir, { recursive: true, force: true });
    const c = v.sites[0]!.checks;
    expect([c.purchase?.decided, c.crawl?.decided, c.post?.decided]).toEqual(["decider", "none", "code"]);
    expect(c.crawl?.verdict).toBe("ASK");
    expect(baselineSection(v, "https://izin.example", "2026-11-10")).toContain("Pairs the decision step answered with a valid decision: **1** of 3. robots.txt allows the URL in 1 of them, and in **1 of 1**");
  });
});

describe("gallery and bench views", () => {
  const dir = mkdtempSync(join(tmpdir(), "izin-baseline-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const galleryPath = join(dir, "gallery.json");
  writeFileSync(galleryPath, JSON.stringify({ sites: [{ host: "shop.example", group: "shopping" }, { host: "other.example", group: "travel" }], blocked_reader: [] }));

  function seeded() {
    const db = new ReceiptStore(openDb(":memory:")).db;
    const put = (id: string, site: string, action: string, r: BaselineReceipt | null) => {
      db.prepare(`INSERT INTO checks (id, created_at, site, url, action, source, status, verdict, receipt_json) VALUES (?, '2026-11-10', ?, ?, ?, 'gallery', ?, ?, ?)`).run(
        id, site, `https://${site}/`, action, r ? "done" : "running", r?.verdict ?? null, r ? JSON.stringify(r) : null,
      );
      db.prepare("INSERT INTO gallery (site, action, check_id, updated_at) VALUES (?, ?, ?, '2026-11-10')").run(site, action, id);
    };
    put("aaaaaaaaaa", "shop.example", "purchase", receipt({ verdict: "NO_GO", clauses: [["prohibits", true]] }));
    put("bbbbbbbbbb", "shop.example", "crawl", receipt({ verdict: "NO_GO", disallowed: true }));
    put("cccccccccc", "other.example", "post", receipt({ verdict: "ASK" }));
    put("dddddddddd", "other.example", "train", null);
    return db;
  }

  it("adds robots_only and words_restrict to each finished cell and counts them", () => {
    const v = galleryView(seeded(), RESTRICT, galleryPath);
    expect(v.sites[0]!.checks.purchase).toMatchObject({ robots_only: "allowed", words_restrict: true });
    expect(v.sites[0]!.checks.crawl).toMatchObject({ robots_only: "disallowed", words_restrict: false });
    expect(v.sites[1]!.checks.post).toMatchObject({ robots_only: "allowed", words_restrict: false });
    expect(v.sites[1]!.checks.train?.robots_only).toBeUndefined();
    expect(v.baseline).toEqual({
      pairs: 3, allowed: 2, disallowed: 1, no_robots: 0, robots_allowed_words_restrict: 1, decided: 3, decided_allowed: 2, decided_allowed_words_restrict: 1,
    });
  });

  it("bench carries the baseline only once a pair has a receipt", () => {
    const empty = galleryView(new ReceiptStore(openDb(":memory:")).db, RESTRICT, galleryPath).baseline;
    expect(benchView(dir, empty).baseline).toBeNull();
    expect(benchView(dir, galleryView(seeded(), RESTRICT, galleryPath).baseline)?.baseline?.robots_allowed_words_restrict).toBe(1);
  });

  it("writes the UKUR section from the view, with the counted pairs and their receipts", () => {
    const v = galleryView(seeded(), RESTRICT, galleryPath);
    const s = baselineSection(v, "https://izin.example/", "2026-11-10");
    expect(s).toContain("## Robots-only baseline");
    expect(s).toContain("**1 of 2**");
    expect(s).toContain("- shop.example, purchase: NO_GO, [receipt](https://izin.example/r/aaaaaaaaaa)");
    expect(s).not.toContain("other.example");
    expect(baselineSection({ sites: [], baseline: baselineCounts([]) }, "https://izin.example", "2026-11-10")).toContain("No gallery pair has a receipt yet.");
  });
});

describe("UKUR sections", () => {
  it("appends a section once, then replaces it in place", () => {
    const first = replaceSection("# What we measured\n\nIntro.\n", "x", "one");
    expect(first).toContain("<!-- izin:x:start -->\none\n<!-- izin:x:end -->");
    const second = replaceSection(`${first}\nAfter.\n`, "x", "two");
    expect(second).not.toContain("one");
    expect(second).toContain("Intro.");
    expect(second).toContain("After.");
    expect(second.match(/izin:x:start/g)).toHaveLength(1);
  });
});

describe("gallery now section", () => {
  const row = (o: Partial<GalleryNowRow>): GalleryNowRow => ({ verdict: "ASK", created_at: "2026-01-02T03:04:05.000Z", serv_verdict: "ASK", ceilings: [], flags: [], model: "m-a", ...o });
  const rows = [
    row({ verdict: "NO_GO", serv_verdict: "NO_GO", created_at: "2026-01-01T10:00:00.000Z", model: "m-old" }),
    row({ verdict: "ASK", serv_verdict: "GO", ceilings: ["S11"] }),
    row({ verdict: "GO", serv_verdict: "GO" }),
    row({ verdict: "ASK", serv_verdict: null, flags: ["decider_skipped"], model: null }),
    row({ verdict: "ASK", serv_verdict: "GO", ceilings: ["S8"], model: null }),
  ];

  it("counts verdicts and how each cell was decided, per receipt day", () => {
    const { total, days } = galleryNowCounts(rows);
    expect(total).toMatchObject({ receipts: 5, GO: 1, ASK: 3, NO_GO: 1, answered: 3, by_code: 1, no_answer: 1 });
    expect(days.map(([d, c]) => [d, c.receipts, c.answered, c.by_code])).toEqual([
      ["2026-01-01", 1, 1, 0],
      ["2026-01-02", 4, 2, 1],
    ]);
    expect(days[1]![1].models).toEqual({ "m-a": 2 });
  });

  it("writes the totals and one table row per day", () => {
    const s = galleryNowSection(rows, "2026-01-03");
    expect(s).toContain("Pairs with a receipt: **5**. GO 1, ASK 3, NO-GO 1.");
    expect(s).toContain("valid answer on **3** of them. On 1 the code decided");
    expect(s).toContain("| 2026-01-01 | 1 | 0 | 0 | 1 | 1 | 0 | 0 | `m-old` (1) |");
    expect(galleryNowSection([], "2026-01-03")).toContain("No gallery pair has a receipt yet.");
  });
});
