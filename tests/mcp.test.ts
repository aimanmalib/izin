// MCP over Streamable HTTP with the SDK's own client against a local server (IZIN_FAKE=1):
// tool list, a check that finishes inside the wait, one that does not, and izin_receipt.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server/app.js";
import { runCheck } from "../server/pipeline.js";
import { createRuntime } from "../server/runtime.js";
import { page, policyText, startSites, testConfig, type Running } from "./helpers/sites.js";

let s: Running | null = null;
let app: FastifyInstance | null = null;
let client: Client | null = null;
afterEach(async () => {
  await client?.close();
  await app?.close();
  await s?.close();
  client = app = s = null;
});

type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

async function setup(opts: { mcpWait?: number; slowMs?: number } = {}) {
  const cfg = testConfig({ mcp_wait_s: opts.mcpWait ?? 25 });
  s = await startSites((u) => ({
    "shop.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/": { body: page("<h1>Shop</h1>", `<a href="${u("shop.example", "/terms")}">Terms of Service</a>`) },
      "/terms": { body: page(`<h1>Terms</h1><p>${policyText("automated access")}</p>`) },
    },
  }));
  const slow = opts.slowMs;
  const rt = createRuntime(cfg, {
    env: { IZIN_FAKE: "1" },
    policy: s.policy,
    alert: async () => true,
    ...(slow ? { run: async (input, deps) => (await new Promise((r) => setTimeout(r, slow)), runCheck(input, deps)) } : {}),
  });
  rt.pipeline.sleep = async () => {};
  app = buildApp(cfg, rt);
  const base = await app.listen({ port: 0, host: "127.0.0.1" });
  client = new Client({ name: "izin-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const call = (name: string, args: Record<string, unknown>) => client!.callTool({ name, arguments: args }) as Promise<ToolResult>;
  return { cfg, rt, call, url: s.url, base };
}

describe("MCP /mcp", () => {
  it("lists izin_check and izin_receipt", async () => {
    await setup();
    const { tools } = await client!.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["izin_check", "izin_receipt"]);
    const check = tools.find((t) => t.name === "izin_check")!;
    expect(Object.keys(check.inputSchema.properties ?? {}).sort()).toEqual(["action", "agent", "detail", "url"]);
  });

  it("izin_check waits for the verdict and returns text plus a short receipt", async () => {
    const { cfg, call, url } = await setup();
    const res = await call("izin_check", { url: url("shop.example", "/"), action: "crawl" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toMatch(/^Verdict: NO_GO\./);
    expect(res.content[0]!.text).toContain(`${cfg.public_origin}/r/`);
    const sc = res.structuredContent!;
    expect(sc).toMatchObject({ verdict: "NO_GO", action: "crawl" });
    expect((sc.decisive_clauses as unknown[]).length).toBeGreaterThan(0);
    expect((sc.decisive_clauses as unknown[]).length).toBeLessThanOrEqual(3);

    const again = await call("izin_receipt", { id: sc.id });
    expect(again.structuredContent).toMatchObject({ id: sc.id, verdict: "NO_GO" });
  });

  it("a check longer than the wait returns running + id + retry_after_s, then izin_receipt gives the verdict", async () => {
    const { cfg, rt, call, url } = await setup({ mcpWait: 1, slowMs: 1500 });
    const res = await call("izin_check", { url: url("shop.example", "/"), action: "crawl" });
    expect(res.structuredContent).toMatchObject({ status: "running", retry_after_s: cfg.limits.mcp_retry_after_s });
    const id = res.structuredContent!.id as string;
    await rt.service.queue.wait(id, 10_000);
    expect((await call("izin_receipt", { id })).structuredContent).toMatchObject({ id, verdict: "NO_GO" });
  });

  it("refused input and unknown ids come back as tool errors", async () => {
    const { call } = await setup();
    const bad = await call("izin_check", { url: "http://10.0.0.1/", action: "crawl" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain("url_not_allowed");
    const nf = await call("izin_receipt", { id: "aaaaaaaaaa" });
    expect(nf.isError).toBe(true);
  });

  it("GET on /mcp is 405 (stateless server, no stream to resume)", async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
  });
});
