import { Buffer } from "node:buffer";
import { ApiError } from "./errors";
import { targetUrl } from "./url-safety";
import type { ResourceInput, ResourceOutput } from "./public-resources";
import { RELAY, RELAY_META, type RelayMeta, type RelayMetrics, type RelayStub } from "./relay-protocol";

/** Shared across both sources; leaves room for quota, browser control and teardown. */
export class RelayBudget {
  calls = 0;
  take(cleanup = false) {
    if (this.calls >= RELAY.internalCalls - (cleanup ? 0 : RELAY.cleanupReserve))
      throw new ApiError("SCRAPE_REQUEST_LIMIT", "The resource transport exceeded the analysis invocation limit.", 422);
    this.calls++;
  }
}

export class RelayResources {
  readonly validatesNetwork = true;
  readonly metrics = { downloads: 0, bytes_received: 0, bytes_completed: 0, failed: 0 };
  readonly transport = { invocations: [] as RelayMetrics[], internal_calls: 0, cancel_calls: 0,
    peak_active: 0, cleanup_confirmed: false, metrics_complete: true,
    queue_wait_ms: 0, relay_fetch_ms: 0, body_read_ms: 0 };
  private controller = new AbortController();
  private signal: AbortSignal;
  private reservedBytes = 0;
  private waiting = new Set<() => void>();
  private active = new Map<RelayStub, Promise<void> | undefined>();
  private jobs = new Set<Promise<ResourceOutput>>();
  private abort = () => this.cancel();
  constructor(private createStub: () => RelayStub, signal: AbortSignal,
    private deadline: number, private budget = new RelayBudget(),
    private totalBytes: number = RELAY.totalBytes) {
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    signal.addEventListener("abort", this.abort, { once: true });
    this.outer = signal;
    if (signal.aborted) this.cancel();
  }
  private outer: AbortSignal;
  cancel(reason?: ApiError) {
    this.controller.abort(reason);
    for (const wake of this.waiting) wake();
    this.waiting.clear();
    for (const [stub, cancelled] of this.active) {
      if (cancelled) continue;
      // Request.signal forwarding across a DO boundary is not assumed. The
      // control request aborts the remote controller and acknowledges teardown.
      const done = (async () => {
        this.budget.take(true);
        this.transport.internal_calls++; this.transport.cancel_calls++;
        const response = await stub.fetch("https://resource-relay/cancel", { method: "POST" });
        await response.body?.cancel();
        if (response.status !== 204) throw new Error("Unconfirmed relay cancellation");
      })();
      done.catch(() => {});
      this.active.set(stub, done);
    }
  }
  load(input: ResourceInput): Promise<ResourceOutput> {
    const job = this.loadOne(input);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
    return job;
  }
  private async loadOne(input: ResourceInput): Promise<ResourceOutput> {
    const queuedAt = Date.now();
    while ((this.active.size >= RELAY.concurrency ||
      (this.active.size > 0 && this.totalBytes - this.metrics.bytes_received - this.reservedBytes < RELAY.resourceBytes)) && !this.signal.aborted)
      await new Promise<void>(resolve => this.waiting.add(resolve));
    this.transport.queue_wait_ms += Date.now() - queuedAt;
    this.signal.throwIfAborted();
    targetUrl(input.url, 16384);
    if ((input.body?.byteLength || 0) > 65536 ||
        Buffer.byteLength(JSON.stringify(input.headers)) > RELAY.headerBytes)
      throw new ApiError("SCRAPE_REQUEST_LIMIT", "A page request exceeded the transport input limit.", 422);
    const maxBytes = Math.min(RELAY.resourceBytes, this.totalBytes - this.metrics.bytes_received - this.reservedBytes);
    if (maxBytes <= 0) throw new ApiError("SCRAPE_RESOURCE_LIMIT", "The page resources exceeded the byte limit.", 422);
    this.budget.take();
    const stub = this.createStub();
    this.active.set(stub, undefined);
    this.reservedBytes += maxBytes;
    this.transport.internal_calls++;
    this.transport.peak_active = Math.max(this.transport.peak_active, this.active.size);
    let measured = false;
    let reservationReleased = false;
    let response: Response | undefined;
    const fetchedAt = Date.now();
    try {
      try {
        response = await stub.fetch("https://resource-relay/load", { method: "POST",
          body: JSON.stringify({ ...input, body: input.body?.toString("base64") ?? null, deadline: this.deadline, maxBytes }) });
      } finally { this.transport.relay_fetch_ms += Date.now() - fetchedAt; }
      const encoded = response.headers.get(RELAY_META);
      if (!response.ok || !encoded) {
        await response.body?.cancel();
        throw new ApiError("SCRAPE_FAILED", "The private resource transport failed.", 502, true);
      }
      const meta = JSON.parse(encoded) as RelayMeta;
      const metric = meta.metrics;
      if (!metric || metric.closed !== true ||
          [metric.external_calls, metric.dns_requests, metric.downloads, metric.redirects,
            metric.bytes_received, metric.bytes_completed, metric.wall_ms].some(n => !Number.isSafeInteger(n) || n < 0) ||
          metric.external_calls > RELAY.externalCalls || metric.dns_requests > 4 || metric.downloads > 1 ||
          metric.redirects > 1 || metric.bytes_completed > metric.bytes_received)
        throw new ApiError("SCRAPE_FAILED", "The resource transport metrics were invalid.", 502);
      this.transport.invocations.push(meta.metrics);
      measured = true;
      this.reservedBytes -= maxBytes; reservationReleased = true;
      this.metrics.downloads += meta.metrics.downloads;
      this.metrics.bytes_received += meta.metrics.bytes_received;
      this.metrics.bytes_completed += meta.metrics.bytes_completed;
      if (meta.error) {
        await response.body?.cancel();
        this.metrics.failed++;
        const failure = new ApiError(meta.error.code, meta.error.message, meta.error.status, meta.error.retryable);
        if (["SCRAPE_RESOURCE_LIMIT", "SCRAPE_REQUEST_LIMIT", "UNSAFE_URL", "DNS_VALIDATION_FAILED"].includes(meta.error.code)) this.cancel(failure);
        throw failure;
      }
      if (this.metrics.bytes_received > this.totalBytes || metric.bytes_completed > maxBytes ||
          metric.bytes_received !== metric.bytes_completed) {
        await response.body?.cancel();
        const failure = new ApiError("SCRAPE_RESOURCE_LIMIT", "The page resources exceeded the byte limit.", 422);
        this.cancel(failure);
        throw failure;
      }
      const reader = response.body?.getReader();
      const bodyStarted = Date.now();
      const abortReader = () => { void reader?.cancel().catch(() => {}); };
      this.signal.addEventListener("abort", abortReader, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (reader) {
          this.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            const failure = new ApiError("SCRAPE_RESOURCE_LIMIT", "The relayed resource exceeded its reserved byte limit.", 422);
            this.cancel(failure);
            throw failure;
          }
          chunks.push(value);
        }
        this.signal.throwIfAborted();
      } finally {
        this.transport.body_read_ms += Date.now() - bodyStarted;
        this.signal.removeEventListener("abort", abortReader);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
      if (size !== meta.metrics.bytes_completed || !meta.status || !meta.headers)
        throw new ApiError("SCRAPE_FAILED", "The relayed resource was incomplete.", 502, true);
      return { status: meta.status, headers: meta.headers, body: Buffer.concat(chunks, size) };
    } catch (error) {
      // A sibling may observe cancellation before the failing job settles.
      // Keep the budget/safety cause instead of reporting a generic abort.
      if (this.signal.aborted && this.signal.reason instanceof ApiError) throw this.signal.reason;
      throw error;
    } finally {
      await response?.body?.cancel().catch(() => {});
      if (!reservationReleased) this.reservedBytes -= maxBytes;
      if (!measured) { this.transport.metrics_complete = false; this.cancel(); }
      const cancelled = this.active.get(stub);
      try { if (cancelled) await cancelled; }
      catch { this.cleanupFailed = true; }
      this.active.delete(stub);
      const wake = this.waiting.values().next().value;
      if (wake) { this.waiting.delete(wake); wake(); }
    }
  }
  private cleanupFailed = false;
  async close(): Promise<void> {
    this.cancel();
    this.outer.removeEventListener("abort", this.abort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled([...this.jobs]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Unconfirmed relay teardown")), 5000);
      })]);
      if (this.cleanupFailed || this.active.size) throw new Error("Unconfirmed relay teardown");
      this.transport.cleanup_confirmed = true;
    } catch {
      throw new ApiError("BROWSER_CLOSE_FAILED", "Resource transport cleanup could not be confirmed.", 503, true);
    } finally { clearTimeout(timer); }
  }
}
