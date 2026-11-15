// Compressed bodies (ADR 0025): decoded before anything reads them, with the size cap applied to
// the decoded bytes. Synthetic sites on a local server; no outside network.
import { createHash } from "node:crypto";
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collect } from "../server/kumpul/collect.js";
import { contentCoding } from "../server/kumpul/coding.js";
import { decodeBody, fetchGuarded } from "../server/kumpul/fetch.js";
import { page, policyText, startSites, testConfig, type Route, type Running } from "./helpers/sites.js";

const html = page("<h1>Shop</h1>", '<a href="/legal/user-agreement">User agreement</a>');
const coded = (encoding: string, body: Buffer, status = 200): Route => ({ status, headers: { "content-encoding": encoding }, body });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("contentCoding", () => {
  it.each([
    ["gzip", "gzip"],
    ["X-GZIP", "gzip"],
    [" deflate ", "deflate"],
    ["br", "br"],
    ["identity, gzip", "gzip"],
    [["gzip"], "gzip"],
  ] as const)("%j -> %s", (header, coding) => {
    expect(contentCoding(header as string | string[])).toBe(coding);
  });

  it.each([undefined, "", "identity", "zstd", "gzip, br", ["gzip", "br"]])("%j is left alone", (header) => {
    expect(contentCoding(header)).toBeNull();
  });
});

describe("fetchGuarded content codings", () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSites({
      "shop.example": {
        "/gzip": coded("gzip", gzipSync(html)),
        "/x-gzip": coded("x-gzip", gzipSync(html)),
        "/br": coded("br", brotliCompressSync(html)),
        "/deflate": coded("deflate", deflateSync(html)),
        "/deflate-bare": coded("deflate", deflateRawSync(html)),
        "/unknown": coded("zstd", Buffer.from(html)),
        "/small-on-the-wire": coded("gzip", gzipSync("x".repeat(50_000))),
        "/cut-short": coded("gzip", gzipSync(html).subarray(0, 40)),
        "/not-brotli": coded("br", Buffer.from("this is not a brotli stream at all")),
        "/challenge": coded("gzip", gzipSync("<title>Just a moment...</title>")),
        "/gone": coded("gzip", Buffer.alloc(0), 404),
        "/gone-cut-short": coded("gzip", gzipSync(html).subarray(0, 40), 404),
      },
    });
  });
  afterAll(() => s.close());
  const get = (path: string, limits = {}) => fetchGuarded(s.url("shop.example", path), { cfg: testConfig(limits), policy: s.policy });

  it.each(["/gzip", "/x-gzip", "/br", "/deflate", "/deflate-bare"])("decodes %s, and size and hash describe the decoded body", async (path) => {
    const r = await get(path);
    expect(r.state).toBe("ok");
    expect(decodeBody(r.body, r.content_type)).toBe(html);
    expect(r.bytes).toBe(Buffer.byteLength(html));
    expect(r.sha256).toBe(sha256(html));
  });

  it("leaves a body with an unknown coding as it arrived", async () => {
    const r = await get("/unknown");
    expect(r.state).toBe("ok");
    expect(r.body.toString("utf8")).toBe(html);
  });

  it("applies the size cap to the decoded bytes", async () => {
    // 50,000 characters travel as a few dozen bytes: under the cap on the wire, over it decoded.
    const r = await get("/small-on-the-wire", { response_max_bytes: 20_000 });
    expect(r.state).toBe("too_large");
    expect(r.bytes).toBeLessThanOrEqual(20_000);
    expect((await get("/small-on-the-wire")).bytes).toBe(50_000);
  });

  it.each([
    ["/cut-short", "content-encoding gzip"],
    ["/not-brotli", "content-encoding br"],
  ])("%s ends in the error state with a note", async (path, note) => {
    const r = await get(path);
    expect(r.state).toBe("error");
    expect(r.note).toBe(note);
  });

  it("sees a challenge page that arrives compressed, and looks at the status before an empty or broken body", async () => {
    expect((await get("/challenge")).state).toBe("blocked");
    expect((await get("/gone")).state).toBe("not_found");
    expect((await get("/gone-cut-short")).state).toBe("not_found");
  });

  it("still asks for no content coding", () => {
    expect(s.hits.length).toBeGreaterThan(0);
    expect(s.hits.filter((h) => "accept-encoding" in h.headers)).toEqual([]);
  });
});

describe("collect with compressed pages", () => {
  it("finds the policy link on a compressed home page and reads the compressed policy page", async () => {
    const terms = page(policyText("user agreement"));
    const s = await startSites({
      "shop.example": {
        "/robots.txt": { type: "text/plain", ...coded("gzip", gzipSync("User-agent: *\nDisallow: /cart\n")) },
        "/": coded("gzip", gzipSync(html)),
        "/legal/user-agreement": coded("br", brotliCompressSync(terms)),
      },
    });
    try {
      const out = await collect({ url: s.url("shop.example") }, { cfg: testConfig(), policy: s.policy });
      expect(out.robots?.state).toBe("ok");
      expect(out.robots?.input_disallowed.any).toBe(false);
      expect(out.docs.map((d) => [new URL(d.url).pathname, d.state])).toEqual([["/legal/user-agreement", "ok"]]);
      expect(out.docs[0]?.text).toContain("Section on user agreement.");
      expect(out.signals).toMatchObject({ docs_read: 1, unreadable: [], blocked: [] });
      expect(out.ledger.map((e) => [e.kind, e.state, e.bytes, e.sha256])).toEqual([
        ["robots", "ok", 30, sha256("User-agent: *\nDisallow: /cart\n")],
        ["home", "ok", Buffer.byteLength(html), sha256(html)],
        ["policy", "ok", Buffer.byteLength(terms), sha256(terms)],
      ]);
    } finally {
      await s.close();
    }
  });
});
