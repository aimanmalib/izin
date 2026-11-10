// Outbound request guard. Izin resolves DNS itself, refuses any address that is not a public
// unicast address, and the fetcher then connects to the address checked here (not a second
// lookup), so a hostname cannot pass the check and then rebind to an internal address.
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class SsrfError extends Error {
  constructor(readonly reason: string) {
    super(`refused: ${reason}`);
    this.name = "SsrfError";
  }
}

export interface NetPolicy {
  /** Resolves a hostname to every address it answers with. */
  lookup(host: string): Promise<string[]>;
  /** True when Izin may connect to this address. */
  ipAllowed(ip: string): boolean;
  ports: readonly number[];
}

// Ranges that are never a public website: private, loopback, link-local (including the cloud
// metadata address 169.254.169.254), carrier-grade NAT, documentation, benchmarking,
// multicast and reserved space. IPv4-mapped IPv6 addresses are unwrapped before the check.
const V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const V6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blocked = new BlockList();
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, "ipv6");

function unwrapMapped(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m?.[1]) return m[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex?.[1] && hex[2]) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return ip;
}

export function isPublicIp(raw: string): boolean {
  const ip = unwrapMapped(raw.replace(/^\[|\]$/g, ""));
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export function defaultPolicy(ports: readonly number[]): NetPolicy {
  return {
    async lookup(host) {
      const answers = await dnsLookup(host, { all: true, verbatim: true });
      return answers.map((a) => a.address);
    },
    ipAllowed: isPublicIp,
    ports,
  };
}

export function hostAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (isIP(h.replace(/^\[|\]$/g, "")) !== 0) return true; // checked as an address below
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  return h.includes(".");
}

/** Validates scheme, port and host, resolves DNS and returns the single address to connect to. */
export async function checkUrl(url: URL, policy: NetPolicy): Promise<string> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("scheme");
  if (url.username || url.password) throw new SsrfError("credentials in URL");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!policy.ports.includes(port)) throw new SsrfError("port");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostAllowed(host)) throw new SsrfError("host");
  const literal = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(literal) !== 0) {
    addresses = [literal];
  } else {
    try {
      addresses = await policy.lookup(host);
    } catch {
      throw new SsrfError("dns");
    }
  }
  if (addresses.length === 0) throw new SsrfError("dns");
  // Every answer must be public: a mixed answer is treated as hostile.
  if (!addresses.every((a) => policy.ipAllowed(a))) throw new SsrfError("address");
  return addresses[0] as string;
}
