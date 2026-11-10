// A local HTTP server that answers for several synthetic hostnames (routed by the Host header),
// plus a network policy that sends those names to it. No outside network is used.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isPublicIp, type NetPolicy } from "../../server/kumpul/ssrf.js";
import { loadConfig, parseConfig, type IzinConfig } from "../../server/config.js";

export interface Route {
  status?: number;
  type?: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
  /** Never answer (for timeout tests). */
  hang?: boolean;
}
export type Sites = Record<string, Record<string, Route>>;

export interface Running {
  port: number;
  url(host: string, path?: string): string;
  hits: { host: string; path: string; headers: IncomingHttpHeaders }[];
  policy: NetPolicy;
  close(): Promise<void>;
}

type UrlFn = (host: string, path?: string) => string;

export async function startSites(def: Sites | ((url: UrlFn) => Sites), extraDns: Record<string, string[]> = {}, listenPort = 0): Promise<Running> {
  const hits: Running["hits"] = [];
  let sites: Sites = {};
  const server: Server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const path = req.url ?? "/";
    hits.push({ host, path, headers: req.headers });
    const route = sites[host]?.[path];
    if (route?.hang) return;
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, { "content-type": route.type ?? "text/html; charset=utf-8", ...route.headers });
    res.end(route.body ?? "");
  });
  await new Promise<void>((r) => server.listen(listenPort, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const url: UrlFn = (host, path = "/") => `http://${host}:${port}${path}`;
  sites = typeof def === "function" ? def(url) : def;
  const policy: NetPolicy = {
    async lookup(host) {
      if (extraDns[host]) return extraDns[host];
      if (sites[host]) return ["127.0.0.1"];
      throw new Error("ENOTFOUND");
    },
    // The test server lives on loopback; every other address goes through the real rule.
    ipAllowed: (ip) => ip === "127.0.0.1" || isPublicIp(ip),
    ports: [port],
  };
  return {
    port,
    url,
    hits,
    policy,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(() => r()));
    },
  };
}

/** Real config with limit overrides, re-validated so tests cannot use an impossible config. */
export function testConfig(limits: Partial<IzinConfig["limits"]> = {}): IzinConfig {
  const base = loadConfig();
  return parseConfig({ ...base, limits: { ...base.limits, host_interval_ms: 1, ...limits } });
}

/** Synthetic policy text of at least `min` characters. Written for these tests only. */
export function policyText(topic: string, min = 1200): string {
  const para = `Section on ${topic}. You may not use any robot, spider, scraper or other automated means to access the service for any purpose without our express written permission. `;
  return para.repeat(Math.ceil(min / para.length));
}

export function page(body: string, footer = ""): string {
  return `<!doctype html><html><head><title>t</title></head><body><main>${body}</main><footer>${footer}</footer></body></html>`;
}
