// MCP over Streamable HTTP at /mcp, stateless: each POST gets a fresh server and transport, so no
// session lives in memory. Two tools: izin_check (waits up to the configured time, then hands
// back an id) and izin_receipt. Texts come from lang/en.json.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACTIONS, LANG_DIR, type IzinConfig } from "../config.js";
import type { Receipt } from "../resit/receipt.js";
import type { ClientIp } from "../api/clientip.js";
import type { CheckService } from "../api/service.js";

type McpTexts = Record<string, string>;

export function mcpTexts(langDir: string = LANG_DIR): McpTexts {
  return (JSON.parse(readFileSync(`${langDir}en.json`, "utf8")) as { mcp: McpTexts }).mcp;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

const text = (s: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });

export function receiptUrl(cfg: IzinConfig, id: string): string {
  return `${cfg.public_origin}/r/${id}`;
}

/** Short form of a receipt for agents: verdict, reason, up to three deciding clauses, links. */
export function shortReceipt(cfg: IzinConfig, r: Receipt) {
  return {
    id: r.id,
    site: r.site,
    action: r.action,
    verdict: r.verdict,
    reason: r.reason,
    conditions: r.conditions,
    missing: r.missing,
    decisive_clauses: r.clauses
      .filter((c) => c.decisive)
      .slice(0, 3)
      .map((c) => ({ quote: c.quote, stance: c.stance, category: c.category, source: c.fragment_url ?? c.source_url })),
    receipt_url: receiptUrl(cfg, r.id),
    receipt_json_url: `${cfg.public_origin}/api/receipt/${r.id}`,
    receipt_sha256: r.receipt_sha256,
  };
}

function doneResult(cfg: IzinConfig, t: McpTexts, r: Receipt): CallToolResult {
  const s = shortReceipt(cfg, r);
  const lines = [fill(t.verdict_line!, { verdict: s.verdict, reason: s.reason })];
  if (s.decisive_clauses.length) {
    lines.push(t.clauses_head!, ...s.decisive_clauses.map((c) => `- "${c.quote}" (${c.source})`));
  }
  lines.push(fill(t.receipt_line!, { url: s.receipt_url }));
  return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: s };
}

function pendingResult(cfg: IzinConfig, t: McpTexts, id: string): CallToolResult {
  const retry = cfg.limits.mcp_retry_after_s;
  return { content: [{ type: "text", text: fill(t.running!, { id, retry }) }], structuredContent: { status: "running", id, retry_after_s: retry } };
}

export interface McpDeps {
  cfg: IzinConfig;
  service: CheckService;
  texts: McpTexts;
}

function statusResult(d: McpDeps, id: string): CallToolResult {
  const r = d.service.result(id);
  if (!r) return text(fill(d.texts.not_found!, { id }), true);
  if (r.status === "done" && r.receipt) return doneResult(d.cfg, d.texts, r.receipt);
  if (r.status === "error") return text(d.texts.failed!, true);
  return pendingResult(d.cfg, d.texts, id);
}

export function buildMcpServer(d: McpDeps, ip: string, version: string): McpServer {
  const { cfg, texts: t, service } = d;
  const server = new McpServer({ name: "izin", version });
  server.registerTool(
    "izin_check",
    {
      title: t.check_title!,
      description: fill(t.check_description!, { wait: cfg.limits.mcp_wait_s }),
      inputSchema: {
        url: z.string().describe(t.arg_url!),
        action: z.enum(ACTIONS).describe(t.arg_action!),
        detail: z.string().max(cfg.limits.detail_max_chars).optional().describe(t.arg_detail!),
        agent: z.string().optional().describe(t.arg_agent!),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const r = await service.submit(args, "mcp", ip);
      switch (r.kind) {
        case "invalid":
          return text(fill(t.invalid!, { code: r.code }), true);
        case "rate_limited":
          return text(fill(t.rate_limited!, { retry: r.retry_after_s }), true);
        case "budget_exhausted":
          return text(r.cached_id ? fill(t.budget_cached!, { url: receiptUrl(cfg, r.cached_id) }) : t.budget!, true);
        case "accepted":
          await service.queue.wait(r.id, cfg.limits.mcp_wait_s * 1000);
          return statusResult(d, r.id);
      }
    },
  );
  server.registerTool(
    "izin_receipt",
    {
      title: t.receipt_title!,
      description: t.receipt_description!,
      inputSchema: { id: z.string().regex(/^[a-z2-7]{6,32}$/).describe(t.arg_id!) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => statusResult(d, id),
  );
  return server;
}

export function registerMcp(app: FastifyInstance, d: McpDeps & { clientIp: ClientIp; version: string }): void {
  app.post("/mcp", async (req, reply) => {
    const server = buildMcpServer(d, d.clientIp(req.socket.remoteAddress, req.headers), d.version);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  // Stateless server: no stream to resume and no session to end.
  const notAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null };
  app.get("/mcp", async (_req, reply) => reply.code(405).header("allow", "POST").send(notAllowed));
  app.delete("/mcp", async (_req, reply) => reply.code(405).header("allow", "POST").send(notAllowed));
}
