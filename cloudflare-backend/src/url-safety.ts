import ipaddr from "ipaddr.js";
import { ApiError, boundedText } from "./errors";
const unsafe = () =>
  new ApiError(
    "UNSAFE_URL",
    "Only public HTTP(S) destinations on their default ports are allowed.",
    422,
  );
export function publicAddress(raw: string): boolean {
  try {
    let ip = ipaddr.parse(raw.replace(/^\[|\]$/g, ""));
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function targetUrl(raw: unknown, maxLength = 2048): URL {
  if (typeof raw !== "string" || !raw || raw.length > maxLength) throw unsafe();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw unsafe();
  }
  const host = u.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    (!host.includes(".") && !host.includes(":")) ||
    /(^|\.)(localhost|local|internal|localdomain|home|lan|metadata)$/.test(host)
  )
    throw unsafe();
  if (ipaddr.isValid(host) && !publicAddress(host)) throw unsafe();
  u.hash = "";
  return u;
}
export interface NetworkPolicy {
  readonly metrics?: { dns_requests: number; validations: number };
  validate(url: string): Promise<void>;
  audit(url: string, address: string): void;
}
export class PublicNetwork implements NetworkPolicy {
  readonly metrics = { dns_requests: 0, validations: 0 };
  private approved = new Map<string, Set<string>>();
  private pending = new Map<string, Promise<string[]>>();
  constructor(
    private fetcher: typeof fetch = fetch,
    private signal?: AbortSignal,
  ) {}
  async validate(raw: string) {
    this.metrics.validations++;
    const u = targetUrl(raw, 16384);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host)) {
      this.approved.set(host, new Set([host]));
      return;
    }
    let promise = this.pending.get(host);
    if (!promise) {
      promise = this.resolve(host);
      this.pending.set(host, promise);
    }
    let addresses: string[];
    try {
      addresses = await promise;
    } finally {
      this.pending.delete(host);
    }
    if (!addresses.length || addresses.some((x) => !publicAddress(x)))
      throw unsafe();
    // Public-to-public rotation is normal for CDNs. Every answer is still
    // checked above; the public fetch transport enforces the connection too.
    // Keep previous validated peers for concurrent responses in direct tests.
    const approved = this.approved.get(host) || new Set<string>();
    for (const address of addresses) approved.add(address);
    if (approved.size > 128) throw unsafe();
    this.approved.set(host, approved);
  }
  private async resolve(host: string) {
    const results = await Promise.allSettled(
      ["A", "AAAA"].map(async (type) => {
        for (const resolver of [
          "https://cloudflare-dns.com/dns-query",
          "https://dns.google/resolve",
        ]) {
          this.signal?.throwIfAborted();
          try {
            const u = new URL(resolver);
            u.searchParams.set("name", host);
            u.searchParams.set("type", type);
            const timeout = AbortSignal.timeout(4000);
            const signal = this.signal
              ? AbortSignal.any([this.signal, timeout])
              : timeout;
            this.metrics.dns_requests++;
            const r = await this.fetcher(u, {
              headers: { accept: "application/dns-json" },
              signal,
              redirect: "manual",
            });
            if (!r.ok) {
              await r.body?.cancel();
              continue;
            }
            const p = JSON.parse(await boundedText(r, 32768, signal)) as {
              Status?: number;
              Answer?: { type: number; data: string }[];
            };
            if (p.Status !== 0) continue;
            return (p.Answer || [])
              .filter((x) => x.type === (type === "A" ? 1 : 28))
              .map((x) => x.data);
          } catch {
            this.signal?.throwIfAborted();
          }
        }
        throw new ApiError(
          "DNS_VALIDATION_FAILED",
          "The destination could not be validated.",
          422,
        );
      }),
    );
    // Wait for both DNS readers before claiming teardown (including errors).
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  }
  audit(raw: string, address: string) {
    const host = targetUrl(raw, 16384).hostname.replace(/^\[|\]$/g, "");
    const canonical = (s: string) => ipaddr.process(s).toNormalizedString();
    if (!publicAddress(address))
      throw new ApiError(
        "UNSAFE_URL",
        "The connected resource address is not public.",
        422,
      );
    if (!this.approved.has(host))
      throw new ApiError(
        "UNSAFE_URL",
        "The response hostname was not validated.",
        422,
      );
    if (
      ![...(this.approved.get(host) || [])].some(
        (ip) => canonical(ip) === canonical(address),
      )
    )
      throw new ApiError(
        "UNSAFE_URL",
        "The response address did not match the validated DNS result.",
        422,
      );
  }
}
