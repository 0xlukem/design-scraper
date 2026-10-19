import type { BudgetStatus, PublicQuota } from './telemetry-contract';
import { DurableObject } from "cloudflare:workers";
import { config, type Config, type Settings } from "./config";
import { maximumMicroUsd } from "./cost";
export { estimateMicroUsd, maximumMicroUsd } from "./cost";
export interface Reservation {
  id: string;
  ip: string;
  sources: number;
  now: number;
  provider: string;
  version: string;
  funding?: "demo" | "byok";
}
interface Lease {
  providerCalls?: number;
  expires: number;
  browser: number;
  tokens: number;
  day: string;
  microUsd?: number;
  funding?: "demo" | "byok";
}
interface CallCounts { generation: number; auxiliary: number }
interface State {
  callsSince?: number;
  dailyCalls?: CallCounts;
  totalCalls?: CallCounts;
  day: string;
  count: number;
  browser: number;
  tokens: number;
  nextBrowser: number;
  ips: Record<string, { count: number; expires: number }>;
  dailyIps?: Record<string, number>;
  dailyMicroUsd?: number;
  totalMicroUsd?: number;
  leases: Record<string, Lease>;
  circuits: Record<
    string,
    { failures: number; until: number; permanent: boolean; version: string }
  >;
}
export type Admission =
  | { ok: true }
  | { ok: false; code: string; status: number; retryAfter: number };
export const newState = (now: number): State => ({
  day: new Date(now).toISOString().slice(0, 10),
  count: 0,
  browser: 0,
  tokens: 0,
  nextBrowser: 0,
  ips: {},
  leases: {},
  circuits: {},
  dailyIps: {},
  dailyMicroUsd: 0,
  totalMicroUsd: 0,
});
function prepare(s: State, now: number, c: Config) {
  // Older deployments persisted tokens only. Keep a conservative valuation of
  // that outstanding usage instead of resetting budgets during this upgrade.
  const legacyCost = c.budgetEnabled ? Math.ceil(s.tokens * Math.max(c.inputPrice, c.outputPrice)) : 0;
  s.dailyMicroUsd ??= legacyCost;
  s.totalMicroUsd ??= legacyCost;
  s.dailyIps ??= Object.fromEntries(Object.entries(s.ips).map(([ip, v]) => [ip, v.count]));
  for (const lease of Object.values(s.leases))
    lease.microUsd ??= c.budgetEnabled ? Math.ceil(lease.tokens * Math.max(c.inputPrice, c.outputPrice)) : 0;
  s.callsSince ??= now;
  s.dailyCalls ??= { generation: 0, auxiliary: 0 };
  s.totalCalls ??= { generation: 0, auxiliary: 0 };
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== s.day) {
    s.day = day;
    s.count = 0;
    s.dailyCalls = { generation: 0, auxiliary: 0 };
    s.browser = 0;
    s.tokens = 0;
    s.dailyMicroUsd = 0;
    s.dailyIps = {};
    // A job spanning midnight can consume the new day's budget. Carry its
    // reservation forward until settlement; never grant unreserved capacity.
    for (const lease of Object.values(s.leases)) {
      if (lease.expires > now) {
        s.browser += lease.browser;
        s.tokens += lease.tokens;
        s.dailyMicroUsd += lease.microUsd!;
        lease.day = day;
      }
    }
  }
}
export function reserve(s: State, r: Reservation, c: Config): Admission {
  prepare(s, r.now, c);
  const day = s.day;
  for (const [key, v] of Object.entries(s.ips))
    if (v.expires <= r.now) delete s.ips[key];
  for (const [key, v] of Object.entries(s.leases))
    if (v.expires <= r.now) delete s.leases[key];
  const deny = (code: string, status: number, ms: number): Admission => ({
    ok: false,
    code,
    status,
    retryAfter: Math.max(1, Math.ceil(ms / 1000)),
  });
  const byok = r.funding === "byok";
  const circuit = byok ? undefined : s.circuits[r.provider];
  if (!byok && circuit?.version !== r.version) delete s.circuits[r.provider];
  else if (circuit && (circuit.permanent || circuit.until > r.now))
    return deny(
      circuit.permanent ? "PROVIDER_UNAVAILABLE" : "PROVIDER_CIRCUIT_OPEN",
      503,
      circuit.until - r.now,
    );
  if (s.leases[r.id]) return deny("DUPLICATE_ANALYSIS", 409, 1000);
  const ip = s.ips[r.ip];
  if (ip && ip.count >= c.ipHourly)
    return deny("RATE_LIMITED", 429, ip.expires - r.now);
  if ((s.dailyIps![r.ip] || 0) >= c.ipDaily)
    return deny("IP_DAILY_LIMIT_REACHED", 429, 86400000 - (r.now % 86400000));
  if (Object.keys(s.leases).length >= c.concurrency)
    return deny("CAPACITY_REACHED", 503, 5000);
  if (s.count >= c.daily)
    return deny("DAILY_LIMIT_REACHED", 429, 86400000 - (r.now % 86400000));
  const browser = (c.scrapeMs + 15000) * r.sources;
  const tokens = byok ? 0 : (c.inputTokens + c.outputTokens) * c.attempts;
  const microUsd = byok || r.provider === "capture-diagnostic" ? 0 : maximumMicroUsd(c);
  if (!byok && c.budgetEnabled && s.totalMicroUsd! + microUsd > c.totalMicroUsd)
    return deny("PROJECT_BUDGET_EXHAUSTED", 429, 0);
  if (!byok && c.budgetEnabled && s.dailyMicroUsd! + microUsd > c.dailyMicroUsd)
    return deny("DAILY_AI_BUDGET_EXHAUSTED", 429, 86400000 - (r.now % 86400000));
  if (s.browser + browser > c.browserDaily)
    return deny("BROWSER_QUOTA_EXHAUSTED", 429, 86400000 - (r.now % 86400000));
  if (!byok && s.tokens + tokens > c.dailyTokens)
    return deny("AI_BUDGET_REACHED", 429, 86400000 - (r.now % 86400000));
  s.count++;
  s.browser += browser;
  s.tokens += tokens;
  s.dailyMicroUsd! += microUsd;
  s.totalMicroUsd! += microUsd;
  s.dailyIps![r.ip] = (s.dailyIps![r.ip] || 0) + 1;
  s.ips[r.ip] = ip
    ? { ...ip, count: ip.count + 1 }
    : { count: 1, expires: r.now + 3600000 };
  s.leases[r.id] = { expires: r.now + c.totalMs + 30000, browser, tokens, day, microUsd, funding: byok ? "byok" : "demo" };
  return { ok: true };
}
export interface Settlement {
  browserMs: number | null;
  tokens: number | null;
  microUsd?: number | null;
  provider: string;
  version: string;
  success?: boolean;
  failure?: "transient" | "configuration" | "quota";
  retryAfter?: number;
}
export function settle(s: State, id: string, result: Settlement, c: Config, now: number) {
  prepare(s, now, c);
  const lease = s.leases[id];
  if (!lease) return;
  delete s.leases[id];
  // The persisted lease decides who pays, never the settlement payload.
  const byok = lease.funding === "byok";
  const actual = byok ? 0 : result.microUsd;
  if (actual !== undefined && actual !== null && Number.isSafeInteger(actual) && actual >= 0) {
    s.totalMicroUsd = Math.max(0, s.totalMicroUsd! - lease.microUsd! + actual);
    if (lease.day === s.day) s.dailyMicroUsd = Math.max(0, s.dailyMicroUsd! - lease.microUsd! + actual);
  }
  if (lease.day === s.day) {
    if (result.browserMs !== null && Number.isFinite(result.browserMs) && result.browserMs >= 0)
      s.browser = Math.max(0, s.browser - lease.browser + Math.ceil(result.browserMs));
    if (!byok && result.tokens !== null && Number.isFinite(result.tokens) && result.tokens >= 0)
      s.tokens = Math.max(0, s.tokens - lease.tokens + Math.ceil(result.tokens));
  }
  if (byok) return;
  const prior = s.circuits[result.provider];
  if (result.failure) {
    const failures = (prior?.version === result.version ? prior.failures : 0) + 1;
    s.circuits[result.provider] = {
      failures, version: result.version, permanent: result.failure === "configuration",
      until: now + (result.failure === "quota" ? Math.max(c.cooldown, (result.retryAfter || 60) * 1000) : failures >= c.failureThreshold ? c.cooldown : 0),
    };
  } else if (result.success) delete s.circuits[result.provider];
}
// Record dispatch attempts before provider I/O. Retransmitting the same sequence
// is idempotent; the persisted funding marker keeps BYOK out of demo counters.
export function recordProviderCall(s: State, id: string, sequence: number, kind: 'generation' | 'auxiliary', c: Config, now: number) {
  prepare(s, now, c);
  const lease = s.leases[id];
  if (!lease || lease.expires <= now) throw new Error('No active lease');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > c.attempts + 1 || !['generation', 'auxiliary'].includes(kind)) throw new Error('Invalid provider call');
  if (sequence <= (lease.providerCalls || 0)) return;
  if (sequence !== (lease.providerCalls || 0) + 1) throw new Error('Invalid provider sequence');
  lease.providerCalls = sequence;
  if (lease.funding === 'byok') return;
  s.dailyCalls![kind]++;
  s.totalCalls![kind]++;
}

export class QuotaCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS quota (id INTEGER PRIMARY KEY, state TEXT NOT NULL)",
    );
  }
  private update<T>(fn: (s: State) => T): T {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{ state: string }>("SELECT state FROM quota WHERE id = 1")
        .toArray()[0];
      const s: State = row ? JSON.parse(row.state) : newState(Date.now());
      const result = fn(s);
      this.ctx.storage.sql.exec(
        "INSERT INTO quota(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
        JSON.stringify(s),
      );
      return result;
    });
  }
  async admit(r: Omit<Reservation, "now">): Promise<Admission> {
    const result = this.update((s) =>
      reserve(
        s,
        { ...r, now: Date.now() },
        config(this.env as unknown as Settings),
      ),
    );
    await this.ctx.storage.setAlarm(Date.now() + 86400000);
    return result;
  }
  browserStart(id: string): number {
    return this.update((s) => {
      if (!s.leases[id] || s.leases[id].expires < Date.now())
        throw new Error("No active lease");
      const c = config(this.env as unknown as Settings);
      const start = Math.max(Date.now(), s.nextBrowser);
      s.nextBrowser = start + c.startInterval;
      return Math.max(0, start - Date.now());
    });
  }
  providerCall(id: string, sequence: number, kind: 'generation' | 'auxiliary'): void {
    this.update(s => recordProviderCall(s, id, sequence, kind, config(this.env as unknown as Settings), Date.now()));
  }
  publicStatus(): PublicQuota {
    const s = this.status();
    const c = config(this.env as unknown as Settings);
    return {
      day: s.day, resets_at: new Date(Date.parse(s.day + 'T00:00:00Z') + 86400000).toISOString(),
      analyses: { used: s.admitted, limit: c.daily, remaining: Math.max(0, c.daily - s.admitted) },
      capture: { used_or_reserved_ms: s.browserMsUsedOrReserved, limit_ms: c.browserDaily, remaining_ms: Math.max(0, c.browserDaily - s.browserMsUsedOrReserved) },
      concurrency: { active: s.active, limit: c.concurrency },
      per_ip: { hourly_limit: c.ipHourly, daily_limit: c.ipDaily },
      demo_budget_available: (!c.budgetEnabled || (s.dailyMicroUsdUsedOrReserved! + maximumMicroUsd(c) <= c.dailyMicroUsd && s.totalMicroUsdUsedOrReserved! + maximumMicroUsd(c) <= c.totalMicroUsd)) && s.tokensUsedOrReserved + (c.inputTokens + c.outputTokens) * c.attempts <= c.dailyTokens,
    };
  }
  status(): BudgetStatus {
    return this.update((s) => {
      const c = config(this.env as unknown as Settings);
      prepare(s, Date.now(), c);
      const active = Object.values(s.leases).filter(v => v.expires > Date.now());
      return {
        demoCalls: { since: new Date(s.callsSince!).toISOString(), daily: s.dailyCalls!, total: s.totalCalls! },
        activeReservations: {
          browserMs: active.reduce((sum, v) => sum + v.browser, 0),
          tokens: active.filter(v => v.funding !== 'byok').reduce((sum, v) => sum + v.tokens, 0),
          microUsd: active.filter(v => v.funding !== 'byok').reduce((sum, v) => sum + (v.microUsd || 0), 0),
        },
        day: s.day, admitted: s.count, dailyLimit: c.daily,
        ipHourlyLimit: c.ipHourly, ipDailyLimit: c.ipDaily,
        browserMsUsedOrReserved: s.browser, browserMsLimit: c.browserDaily,
        tokensUsedOrReserved: s.tokens, dailyTokenLimit: c.dailyTokens,
        dailyMicroUsdUsedOrReserved: s.dailyMicroUsd!,
        totalMicroUsdUsedOrReserved: s.totalMicroUsd!,
        dailyMicroUsdLimit: c.dailyMicroUsd, totalMicroUsdLimit: c.totalMicroUsd,
        costStatus: "estimated", active: Object.values(s.leases).filter(v => v.expires > Date.now()).length,
      };
    });
  }
  finish(id: string, result: Settlement): void {
    this.update((s) => settle(s, id, result, config(this.env as unknown as Settings), Date.now()));
  }
  async alarm() {
    this.update((s) => {
      const now = Date.now();
      for (const [k, v] of Object.entries(s.ips))
        if (v.expires <= now) delete s.ips[k];
      for (const [k, v] of Object.entries(s.leases))
        if (v.expires <= now) delete s.leases[k];
      return null;
    });
  }
}
