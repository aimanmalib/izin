// deploy/traefik.yaml.tmpl: the compress floor must sit below the size of the built index page, or the
// page goes out uncompressed (it carries `no-transform`, so the CDN will not compress it either).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync(join(__dirname, "..", "deploy", "traefik.yaml.tmpl"), "utf8");
const INDEX = readFileSync(join(__dirname, "..", "web", "index.html"), "utf8");

describe("traefik route", () => {
  it("lowers the compress floor below the index page (the built page is larger than its source)", () => {
    const m = ROUTE.match(/compress:\s*\n\s*minResponseBodyBytes:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(Buffer.byteLength(INDEX));
  });

  it("keeps placeholders for every host value", () => {
    expect(ROUTE).toContain("Host(`@DOMAIN@`)");
    expect(ROUTE).toContain("certResolver: @CERT_RESOLVER@");
  });
});
