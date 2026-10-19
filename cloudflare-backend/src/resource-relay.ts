import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { ApiError, boundedText } from "./errors";
import { PublicNetwork, targetUrl } from "./url-safety";
import { PublicResources, type ResourceInput } from "./public-resources";

import { RELAY, RELAY_META, type RelayMeta, type RelayMetrics } from "./relay-protocol";
export { RELAY, RELAY_META, type RelayMeta, type RelayMetrics, type RelayStub } from "./relay-protocol";

/** One private, single-use job. No storage, retries, browser or provider credentials. */
export class RelayJob {
  private controller = new AbortController();
  private used = false;
  private finished?: Promise<void>;
  constructor(private fetcher: typeof fetch) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/cancel") {
      this.controller.abort();
      // Acknowledge only after DNS/download readers are closed. Do not wait for
      // consumption of the bounded binary response by the caller.
      await this.finished;
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST" || path !== "/load")
      return new Response(null, { status: 404 });
    if (this.used) return new Response(null, { status: 409 });
    this.used = true;
    const response = this.load(request);
    // Keep only teardown completion. Retaining Promise<Response> here would
    // retain every downloaded body until its single-use object is evicted.
    this.finished = response.then(() => {});
    this.finished.catch(() => {});
    return response;
  }

  private async load(request: Request): Promise<Response> {
    const started = Date.now();
    const metrics: RelayMetrics = { external_calls: 0, dns_requests: 0, downloads: 0,
      redirects: 0, bytes_received: 0, bytes_completed: 0, wall_ms: 0, closed: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let network: PublicNetwork | undefined;
    let resources: PublicResources | undefined;
    let body: Uint8Array<ArrayBuffer> | undefined;
    const meta: RelayMeta = { metrics };
    // Even malformed/stalled internal requests have a finite lifetime.
    timer = setTimeout(() => this.controller.abort(), RELAY.timeoutMs);
    const signal = this.controller.signal;
    const countedFetch: typeof fetch = (input, init) => {
      signal.throwIfAborted();
      if (metrics.external_calls >= RELAY.externalCalls)
        throw new ApiError("SCRAPE_REQUEST_LIMIT", "The resource transport exceeded its invocation limit.", 422);
      metrics.external_calls++;
      return this.fetcher(input, init);
    };
    try {
      signal.throwIfAborted();
      const wire = JSON.parse(await boundedText(new Response(request.body), RELAY.requestBytes, signal)) as {
        url: string; method: string; headers: Record<string, string>; body: string | null; deadline: number; maxBytes?: number;
      };
      if (!wire || typeof wire !== "object" || typeof wire.method !== "string" ||
          !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(wire.method) ||
          !wire.headers || typeof wire.headers !== "object" || Array.isArray(wire.headers) ||
          Object.values(wire.headers).some(value => typeof value !== "string") ||
          Buffer.byteLength(JSON.stringify(wire.headers)) > RELAY.headerBytes ||
          (wire.body !== null && (typeof wire.body !== "string" || wire.body.length > 87384)) ||
          !Number.isFinite(wire.deadline) ||
          (wire.maxBytes !== undefined && (!Number.isInteger(wire.maxBytes) || wire.maxBytes < 1 || wire.maxBytes > RELAY.resourceBytes)))
        throw new ApiError("INVALID_REQUEST", "Invalid resource transport request.", 422);
      const remaining = Math.min(RELAY.timeoutMs, wire.deadline - Date.now());
      if (remaining <= 0) throw new ApiError("SCRAPE_TIMEOUT", "The resource deadline expired.", 504, true);
      clearTimeout(timer);
      timer = setTimeout(() => this.controller.abort(), remaining);
      const input: ResourceInput = { url: targetUrl(wire.url, 16384).href, method: wire.method,
        headers: wire.headers, body: wire.body === null ? null : Buffer.from(wire.body, "base64") };
      if (input.body && input.body.byteLength > 65536)
        throw new ApiError("SCRAPE_REQUEST_LIMIT", "A page request exceeded the body limit.", 422);
      network = new PublicNetwork(countedFetch, signal);
      resources = new PublicResources(countedFetch, signal, {
        resourceBytes: wire.maxBytes ?? RELAY.resourceBytes, totalBytes: wire.maxBytes ?? RELAY.resourceBytes,
      });
      await network.validate(input.url);
      const result = await resources.load(input);
      if ([301, 302, 303, 307, 308].includes(result.status)) metrics.redirects++;
      // Redirects return to the browser. Every subsequent hop is a new job
      // with fresh validation; capture enforces the complete chain length.
      meta.status = result.status;
      meta.headers = result.headers;
      if (Buffer.byteLength(JSON.stringify(meta.headers)) > RELAY.headerBytes)
        throw new ApiError("SCRAPE_RESOURCE_LIMIT", "Resource headers exceeded the byte limit.", 422);
      body = new Uint8Array(result.body);
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError(
        signal.aborted ? "SCRAPE_TIMEOUT" : "SCRAPE_FAILED",
        signal.aborted ? "The resource download was cancelled or timed out." : "A required resource could not be loaded.",
        signal.aborted ? 504 : 502, true);
      meta.error = { code: e.code, message: e.message, status: e.status, retryable: e.retryable };
      delete meta.headers; delete meta.status; body = undefined;
    } finally {
      clearTimeout(timer);
      resources?.cancel();
      metrics.dns_requests = network?.metrics.dns_requests || 0;
      metrics.downloads = resources?.metrics.downloads || 0;
      metrics.bytes_received = resources?.metrics.bytes_received || 0;
      metrics.bytes_completed = resources?.metrics.bytes_completed || 0;
      metrics.wall_ms = Date.now() - started;
      metrics.closed = true;
    }
    return new Response(body, { headers: {
      "content-type": "application/octet-stream", "cache-control": "no-store",
      [RELAY_META]: JSON.stringify(meta),
    } });
  }
}

/** Binding-only entrypoint; the public Worker never routes requests here. */
export class ResourceRelay extends DurableObject<Env> {
  private job = new RelayJob((...args) => fetch(...args));
  fetch(request: Request) { return this.job.fetch(request); }
}
