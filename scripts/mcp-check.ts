// H5: calls the izin_check MCP tool from an MCP client against a running server, then fetches the
// receipt it names with izin_receipt. A recent receipt for the same pair is served from the cache.
//   npm run mcp-check -- [--base https://izin.sasateguh.com] [--url https://ebay.com/] [--action purchase]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseArgs } from "node:util";
import { loadConfig } from "../server/config.js";

const cfg = loadConfig();
const { values } = parseArgs({
  options: {
    base: { type: "string", default: cfg.public_origin },
    url: { type: "string", default: "https://ebay.com/" },
    action: { type: "string", default: "purchase" },
  },
});

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };
const client = new Client({ name: "izin-h5", version: "0.1.0" });
const t0 = Date.now();
await client.connect(new StreamableHTTPClientTransport(new URL(`${values.base}/mcp`)));
const tools = (await client.listTools()).tools.map((t) => t.name);
const check = (await client.callTool({ name: "izin_check", arguments: { url: values.url, action: values.action } })) as ToolResult;
const body = check.structuredContent ?? {};
const id = typeof body.receipt_id === "string" ? body.receipt_id : typeof body.id === "string" ? body.id : null;
const receipt = id ? ((await client.callTool({ name: "izin_receipt", arguments: { id } })) as ToolResult) : null;
await client.close();
const pass = tools.includes("izin_check") && !check.isError && Boolean(id) && receipt !== null && !receipt.isError;
console.log(JSON.stringify({ base: values.base, tools, status: body.status ?? null, verdict: body.verdict ?? null, receipt_id: id, receipt_ok: receipt ? !receipt.isError : false, ms: Date.now() - t0, pass }));
process.exit(pass ? 0 : 1);
