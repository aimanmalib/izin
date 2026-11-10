// SSRF guard (acceptance H8): private, loopback, link-local, metadata, CGNAT, other ports and
// redirects into any of them are refused, and the connection uses the address that was checked.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, isPublicIp, SsrfError, type NetPolicy } from "../server/kumpul/ssrf.js";
import { decodeBody, fetchGuarded } from "../server/kumpul/fetch.js";
import { startSites, testConfig, type Running } from "./helpers/sites.js";

const fakeDns = (map: Record<string, string[]>): NetPolicy => ({
  lookup: async (h) => map[h] ?? [],
  ipAllowed: isPublicIp,
  ports: [80, 443],
});

async function reason(url: string, policy: NetPolicy): Promise<string> {
  try {
    await checkUrl(new URL(url), policy);
    return "allowed";
  } catch (e) {
    return e instanceof SsrfError ? e.reason : "other";
  }
}

describe("isPublicIp", () => {
  it.each([
    "10.1.2.3", "172.16.5.4", "172.31.255.255", "192.168.0.1", "127.0.0.1", "127.9.9.9", "169.254.169.254",
    "169.254.1.1", "100.64.0.1", "100.127.255.254", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::",
    "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
    "64:ff9b::a00:1", "not-an-ip",
  ])("refuses %s", (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(["93.184.216.34", "1.1.1.1", "100.128.0.1", "2606:4700::1111"])("allows %s", (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe("checkUrl", () => {
  const dns = fakeDns({
    "public.example": ["93.184.216.34"],
    "private.example": ["10.0.0.5"],
    "mixed.example": ["93.184.216.34", "192.168.1.10"],
    "meta.example": ["169.254.169.254"],
    "cgnat.example": ["100.64.1.1"],
    "v6local.example": ["::1"],
  });

  it.each([
    ["http://localhost/", "host"],
    ["http://foo.localhost/", "host"],
    ["http://intranet/", "host"],
    ["http://public.example:8080/", "port"],
    ["https://public.example:22/", "port"],
    ["ftp://public.example/", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["http://user:pw@public.example/", "credentials in URL"],
    ["http://private.example/", "address"],
    ["http://mixed.example/", "address"],
    ["http://meta.example/latest/meta-data", "address"],
    ["http://cgnat.example/", "address"],
    ["http://v6local.example/", "address"],
    ["http://169.254.169.254/latest/meta-data", "address"],
    ["http://127.0.0.1/", "address"],
    ["http://[::1]/", "address"],
    ["http://unknown.example/", "dns"],
  ])("%s -> %s", async (url, why) => {
    expect(await reason(url, dns)).toBe(why);
  });

  it("returns the checked address for a public host", async () => {
    expect(await checkUrl(new URL("https://public.example/terms"), dns)).toBe("93.184.216.34");
  });
});

describe("fetchGuarded redirects and pinning", () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSites(
      {
        "shop.example": {
          "/to-private": { status: 302, headers: { location: "http://internal.example/" } },
          "/to-meta": { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data" } },
          "/to-port": { status: 302, headers: { location: "http://shop.example:9/" } },
          "/to-banned": { status: 302, headers: { location: "https://devpost.com/" } },
          "/loop": { status: 302, headers: { location: "/loop" } },
          "/ok": { body: "hello" },
        },
        "rebind.example": { "/ok": { body: "hello" } },
      },
      { "internal.example": ["10.0.0.7"], "rebind.example": ["127.0.0.1"] },
    );
  });
  afterAll(() => s.close());
  const cfg = testConfig();
  const opts = () => ({ cfg, policy: s.policy, refuseHost: (h: string) => cfg.do_not_fetch_hosts.some((d) => h === d || h.endsWith(`.${d}`)) });

  it.each(["/to-private", "/to-meta", "/to-port", "/to-banned"])("refuses the hop after %s", async (path) => {
    const r = await fetchGuarded(s.url("shop.example", path), opts());
    expect(r.state).toBe("refused");
    expect(r.body.length).toBe(0);
  });

  it("stops after the redirect limit", async () => {
    const r = await fetchGuarded(s.url("shop.example", "/loop"), opts());
    expect(r.state).toBe("error");
    expect(r.note).toBe("too many redirects");
    expect(s.hits.filter((h) => h.path === "/loop").length).toBe(cfg.limits.redirects_max + 1);
  });

  it("connects to the checked address, not a fresh system lookup", async () => {
    // rebind.example does not exist in real DNS: success proves the pinned address was used.
    const r = await fetchGuarded(`http://rebind.example:${s.port}/ok`, opts());
    expect(r.state).toBe("ok");
  });
});

describe("fetchGuarded limits and states", () => {
  let s: Running;
  beforeAll(async () => {
    s = await startSites({
      "shop.example": {
        "/hang": { hang: true },
        "/big": { body: "x".repeat(5000) },
        "/forbidden": { status: 403, body: "no" },
        "/challenge": { body: "<title>Just a moment...</title>" },
        "/gone": { status: 410, body: "" },
        "/err": { status: 500, body: "" },
        "/latin": { type: "text/plain; charset=iso-8859-1", body: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
      },
    });
  });
  afterAll(() => s.close());
  const get = (path: string, limits = {}) => fetchGuarded(s.url("shop.example", path), { cfg: testConfig(limits), policy: s.policy });

  it("times out without retrying", async () => {
    expect((await get("/hang", { fetch_timeout_ms: 300 })).state).toBe("timeout");
    expect(s.hits.filter((h) => h.path === "/hang").length).toBe(1);
  });

  it("caps the body size", async () => {
    const r = await get("/big", { response_max_bytes: 1000 });
    expect(r.state).toBe("too_large");
    expect(r.bytes).toBeLessThanOrEqual(1000);
  });

  it.each([
    ["/forbidden", "blocked"],
    ["/challenge", "blocked"],
    ["/gone", "not_found"],
    ["/err", "error"],
  ])("%s -> %s", async (path, state) => {
    expect((await get(path)).state).toBe(state);
  });

  it("decodes the declared charset", async () => {
    const r = await get("/latin");
    expect(decodeBody(r.body, r.content_type)).toBe("café");
  });
});
