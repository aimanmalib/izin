// Serves the Set B synthetic sites (b01.example ...) on loopback for one benchmark process, and a
// network policy that sends only those names there. Every other host keeps the normal rule; a real
// name that resolves to loopback is answered with an address the rule refuses.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isPublicIp, type NetPolicy } from "../kumpul/ssrf.js";
import type { SyntheticSite } from "./sets.js";

export interface SyntheticServer {
  port: number;
  url(host: string, path?: string): string;
  policy: NetPolicy;
  close(): Promise<void>;
}

const LOOPBACK = "127.0.0.1";

export async function serveSynthetic(sites: SyntheticSite[], base: NetPolicy): Promise<SyntheticServer> {
  const byHost = new Map(sites.map((s) => [s.host, s.routes]));
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const route = byHost.get(host)?.[req.url ?? "/"];
    if (!route) return void res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    res.writeHead(route.status, { "content-type": `${route.type}; charset=utf-8` }).end(route.body);
  });
  await new Promise<void>((r) => server.listen(0, LOOPBACK, r));
  const port = (server.address() as AddressInfo).port;
  const policy: NetPolicy = {
    async lookup(host) {
      if (byHost.has(host)) return [LOOPBACK];
      return (await base.lookup(host)).map((ip) => (ip === LOOPBACK || ip === "::1" ? "0.0.0.0" : ip));
    },
    ipAllowed: (ip) => ip === LOOPBACK || isPublicIp(ip),
    ports: [...base.ports, port],
  };
  return {
    port,
    url: (host, path = "/") => `http://${host}:${port}${path}`,
    policy,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
