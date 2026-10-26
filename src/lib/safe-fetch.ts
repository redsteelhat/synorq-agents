import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetching addresses that came from outside (business websites) must never
 * reach this server, the Docker network, or anything private. The check runs
 * inside the socket's DNS lookup, so a hostname cannot pass the check and then
 * resolve to a private address for the real connection (DNS rebinding).
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class UnsafeAddressError extends Error {
  constructor(host: string) {
    super(`Refusing to connect to a non-public address for ${host}`);
    this.name = "UnsafeAddressError";
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) {
  lookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      return callback(Object.assign(new UnsafeAddressError(hostname), { code: "EUNSAFE" }), []);
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
}

const dispatcher = new Agent({ connect: { lookup: safeLookup as never, timeout: 8_000 }, headersTimeout: 10_000, bodyTimeout: 10_000 });

export type SafeResponse = { url: string; status: number; headers: Headers; body: string; bytes: number; ms: number; redirects: number };

/** GET a public http(s) URL with manual redirect checks and a size cap. */
export async function safeGet(input: string, options: { maxBytes?: number; maxRedirects?: number; timeoutMs?: number } = {}): Promise<SafeResponse> {
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxRedirects = options.maxRedirects ?? 4;
  const started = Date.now();
  let url = new URL(input);

  for (let redirects = 0; ; redirects += 1) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported protocol ${url.protocol}`);
    if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new UnsafeAddressError(url.hostname);

    const response = await undiciFetch(url, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SynorqSiteCheck/1.0; +https://synorq.com)", Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "tr-TR,tr;q=0.9" },
    });

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel();
      if (redirects >= maxRedirects) throw new Error("Too many redirects");
      url = new URL(response.headers.get("location")!, url);
      continue;
    }

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { url: url.toString(), status: response.status, headers: response.headers as unknown as Headers, body, bytes, ms: Date.now() - started, redirects };
  }
}
