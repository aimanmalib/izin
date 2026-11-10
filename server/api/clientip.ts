// The client address used for rate limits. Headers are only believed along a known chain:
// the socket peer must be the reverse proxy (trusted_proxy_cidrs); the proxy's last
// X-Forwarded-For hop must be a Cloudflare edge (cloudflare_cidrs) before cf-connecting-ip counts.
// Anyone can send those headers directly, so outside that chain they are ignored.
import { BlockList, isIP } from "node:net";
import type { IzinConfig } from "../config.js";

export function blockList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const c of cidrs) {
    const [net, bits] = c.split("/") as [string, string];
    list.addSubnet(net, Number(bits), isIP(net) === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

/** Strips the IPv4-mapped IPv6 prefix so "::ffff:10.0.0.1" matches IPv4 ranges. */
export function bareIp(raw: string): string {
  const s = raw.trim();
  return s.startsWith("::ffff:") && isIP(s.slice(7)) === 4 ? s.slice(7) : s;
}

function inList(list: BlockList, raw: string): boolean {
  const ip = bareIp(raw);
  const v = isIP(ip);
  return v !== 0 && list.check(ip, v === 6 ? "ipv6" : "ipv4");
}

export type ClientIp = (peer: string | undefined, headers: Record<string, string | string[] | undefined>) => string;

const header = (h: string | string[] | undefined) => (Array.isArray(h) ? h.join(",") : h ?? "");

export function makeClientIp(cfg: IzinConfig): ClientIp {
  const proxies = blockList(cfg.network.trusted_proxy_cidrs);
  const edges = blockList(cfg.network.cloudflare_cidrs);
  return (peer, headers) => {
    const sock = bareIp(peer ?? "");
    if (!inList(proxies, sock)) return sock || "unknown";
    const hops = header(headers["x-forwarded-for"]).split(",").map((s) => s.trim()).filter(Boolean);
    const last = bareIp(hops.at(-1) ?? sock);
    const cf = bareIp(header(headers["cf-connecting-ip"]));
    if (cf && isIP(cf) && inList(edges, last)) return cf;
    return isIP(last) ? last : sock;
  };
}
