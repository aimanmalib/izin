import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";

const app = buildApp(loadConfig());
afterAll(() => app.close());

describe("GET /api/health", () => {
  it("answers ok without caching", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
