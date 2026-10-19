export const RELAY = {
  resourceBytes: 8_000_000, totalBytes: 32_000_000, concurrency: 4,
  requestBytes: 131_072, headerBytes: 32_768, timeoutMs: 25_000,
  externalCalls: 8, internalCalls: 800, cleanupReserve: 4,
} as const;
export const RELAY_META = "x-resource-relay";
export interface RelayMetrics {
  external_calls: number; dns_requests: number; downloads: number;
  redirects: number; bytes_received: number; bytes_completed: number;
  wall_ms: number; closed: boolean;
}
export interface RelayMeta {
  metrics: RelayMetrics;
  status?: number;
  headers?: Record<string, string>;
  error?: { code: string; message: string; status: number; retryable: boolean };
}
export type RelayStub = { fetch: typeof fetch };
