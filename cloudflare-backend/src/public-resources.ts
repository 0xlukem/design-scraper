import { Buffer } from "node:buffer";
import { ApiError } from "./errors";
import { RELAY } from "./relay-protocol";
export interface ResourceInput {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | null;
}
export interface ResourceOutput {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
export function isMediaContentType(value: string | null): boolean {
  const mime = (value || "").split(";", 1)[0].trim().toLowerCase();
  return /^(audio|video)\//.test(mime) ||
    ["application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml", "application/ogg"].includes(mime);
}
export interface ResourceTransport {
  load(input: ResourceInput): Promise<ResourceOutput>;
  cancel?(): void;
  close?(): Promise<void>;
  readonly validatesNetwork?: boolean;
  readonly metrics?: { downloads: number; bytes_received: number; bytes_completed: number; failed: number };
  readonly transport?: { invocations: import("./resource-relay").RelayMetrics[]; internal_calls: number;
    cancel_calls: number; peak_active: number; cleanup_confirmed: boolean; metrics_complete: boolean };
}
/** Runs only with the global, public-internet Workers fetch capability. No private/VPC binding. */
export class PublicResources {
  private bytes = 0;
  private controller = new AbortController();
  private signal: AbortSignal;
  private active = 0;
  private waiting = new Set<() => void>();
  readonly metrics = { downloads: 0, bytes_received: 0, bytes_completed: 0, failed: 0 };
  constructor(
    private fetcher: typeof fetch,
    signal: AbortSignal,
    private limits: { resourceBytes: number; totalBytes: number } = RELAY,
  ) {
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    this.signal.addEventListener("abort", () => { for (const wake of this.waiting) wake(); this.waiting.clear(); }, { once: true });
  }
  cancel() { this.controller.abort(); }
  async load(input: ResourceInput): Promise<ResourceOutput> {
    while (this.active >= RELAY.concurrency && !this.signal.aborted)
      await new Promise<void>(resolve => this.waiting.add(resolve));
    this.signal.throwIfAborted();
    this.active++;
    try { return await this.download(input); }
    finally {
      this.active--;
      const wake = this.waiting.values().next().value;
      if (wake) { this.waiting.delete(wake); wake(); }
    }
  }
  private async download(input: ResourceInput): Promise<ResourceOutput> {
    this.signal.throwIfAborted();
    if (input.body && input.body.byteLength > 65536)
      throw new ApiError(
        "SCRAPE_REQUEST_LIMIT",
        "A page request exceeded the body limit.",
        422,
      );
    const headers = new Headers();
    for (const [key, value] of Object.entries(input.headers))
      if (
        !/^(host|connection|content-length|accept-encoding|authorization|proxy-.*|cf-.*|x-forwarded-.*)$/i.test(
          key,
        )
      )
        headers.set(key, value);
    headers.set("accept-encoding", "identity");
    this.metrics.downloads++;
    const response = await this.fetcher(input.url, {
      method: input.method,
      headers,
      ...(input.body ? { body: new Uint8Array(input.body) } : {}),
      redirect: "manual",
      signal: this.signal,
    });
    // A JS player can fetch an opaque URL without a media extension. Read only
    // its headers, close the body, and let capture record the media exclusion.
    // Keep redirects intact so each next hop is still independently validated.
    if (response.ok && isMediaContentType(response.headers.get("content-type"))) {
      await response.body?.cancel();
      this.signal.throwIfAborted();
      return { status: response.status, headers: { "content-type": response.headers.get("content-type")! }, body: Buffer.alloc(0) };
    }
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    const abort = () => {
      void reader?.cancel().catch(() => {});
    };
    this.signal.addEventListener("abort", abort, { once: true });
    try {
      while (reader) {
        this.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        this.bytes += value.byteLength;
        this.metrics.bytes_received += value.byteLength;
        if (size > this.limits.resourceBytes || this.bytes > this.limits.totalBytes) {
          await reader.cancel();
          throw new ApiError(
            "SCRAPE_RESOURCE_LIMIT",
            "The page resources exceeded the byte limit.",
            422,
          );
        }
        chunks.push(value);
      }
      this.signal.throwIfAborted();
    } catch (error) {
      this.metrics.failed++;
      throw error;
    } finally {
      this.signal.removeEventListener("abort", abort);
      // Abort may occur after fetch resolves but before the listener attaches.
      // Always close the body, including that already-aborted acquisition race.
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
    const out = Object.fromEntries(response.headers);
    for (const key of ["content-length", "transfer-encoding", "connection"])
      delete out[key];
    this.metrics.bytes_completed += size;
    return {
      status: response.status,
      headers: out,
      body: Buffer.concat(chunks),
    };
  }
}
