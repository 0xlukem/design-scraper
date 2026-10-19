import { it, expect } from "vitest";
import { reserve, newState, settle, maximumMicroUsd } from "../src/quota";
import { config } from "../src/config";
const now = Date.UTC(2026, 8, 9, 10);
const c = config({});
const r = {
  id: "one",
  ip: "hash",
  sources: 1,
  now,
  provider: "gemini",
  version: "1",
};
it("atomically reserves concurrency and maximum AI/browser budgets", () => {
  const s = newState(now);
  expect(reserve(s, r, c)).toEqual({ ok: true });
  expect(reserve(s, { ...r, id: "two" }, c)).toMatchObject({
    code: "CAPACITY_REACHED",
  });
  expect(s.count).toBe(1);
  expect(s.tokens).toBe(114000);
});
it("retains budget for expired leases but frees concurrency", () => {
  const s = newState(now);
  reserve(s, r, c);
  expect(
    reserve(s, { ...r, id: "two", now: now + c.totalMs + 40000 }, c),
  ).toMatchObject({ code: "AI_BUDGET_REACHED" });
  expect(Object.keys(s.leases)).toHaveLength(0);
});
it("rolls daily counters at UTC without dropping a live lease", () => {
  const late = Date.UTC(2026, 8, 9, 23, 59, 55);
  const s = newState(late);
  reserve(s, { ...r, now: late }, c);
  expect(reserve(s, { ...r, id: "two", now: late + 10000 }, c)).toMatchObject({
    code: "CAPACITY_REACHED",
  });
  expect(s.count).toBe(0);
});
it("honors configuration faults until the operator changes configuration version", () => {
  const s = newState(now);
  s.circuits.gemini = {
    version: "1",
    failures: 1,
    permanent: true,
    until: now,
  };
  expect(reserve(s, r, c)).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  expect(reserve(s, { ...r, version: "2" }, c)).toEqual({ ok: true });
});
it("fails closed on browser and per-IP limits", () => {
  const s = newState(now);
  expect(reserve(s, r, { ...c, browserDaily: 1000 })).toMatchObject({
    code: "BROWSER_QUOTA_EXHAUSTED",
  });
  s.ips.hash = { count: c.ipHourly, expires: now + 60000 };
  expect(reserve(s, r, c)).toMatchObject({ code: "RATE_LIMITED" });
});

const paid = config({ AI_BUDGET_ENABLED: "true", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75", DAILY_AI_TOKEN_LIMIT: "2000000", GLOBAL_DAILY_LIMIT: "20" });
const finish = (s: ReturnType<typeof newState>, id: string, cost: number | null, at = now) =>
  settle(s, id, { browserMs: 1000, tokens: 5000, microUsd: cost, provider: "gemini", version: "1" }, paid, at);

it("enforces the IP daily cap across separate hourly windows", () => {
  const s = newState(now);
  for (let i = 0; i < 5; i++) {
    const at = now + i * 3600001;
    expect(reserve(s, { ...r, id: String(i), now: at }, paid).ok).toBe(true);
    finish(s, String(i), 10000, at);
  }
  expect(reserve(s, { ...r, now: now + 5 * 3600001 }, paid)).toMatchObject({ code: "IP_DAILY_LIMIT_REACHED" });
  expect(reserve(s, { ...r, ip: "another", now: now + 5 * 3600001 }, paid).ok).toBe(true);
});
it("rejects the 21st global admission without spending additional budget", () => {
  const s = newState(now);
  for (let i = 0; i < 20; i++) {
    expect(reserve(s, { ...r, id: String(i), ip: String(i) }, paid).ok).toBe(true);
    finish(s, String(i), 10000);
  }
  const before = s.totalMicroUsd;
  expect(reserve(s, { ...r, ip: "new" }, paid)).toMatchObject({ code: "DAILY_LIMIT_REACHED" });
  expect(s.totalMicroUsd).toBe(before);
});
it("checks daily and lifetime money before admitting any generation", () => {
  const s = newState(now);
  s.dailyMicroUsd = paid.dailyMicroUsd - maximumMicroUsd(paid) + 1;
  expect(reserve(s, r, paid)).toMatchObject({ code: "DAILY_AI_BUDGET_EXHAUSTED" });
  s.dailyMicroUsd = 0;
  s.totalMicroUsd = paid.totalMicroUsd - maximumMicroUsd(paid) + 1;
  expect(reserve(s, r, paid)).toMatchObject({ code: "PROJECT_BUDGET_EXHAUSTED" });
  expect(s.count).toBe(0);
  expect(s.leases).toEqual({});
});
it("settles actual usage exactly once, preserves unknown charges and ignores invalid refunds", () => {
  const s = newState(now);
  reserve(s, r, paid);
  finish(s, r.id, 50000);
  finish(s, r.id, 0);
  expect(s.totalMicroUsd).toBe(50000);
  reserve(s, { ...r, id: "unknown" }, paid);
  finish(s, "unknown", null);
  expect(s.totalMicroUsd).toBe(50000 + maximumMicroUsd(paid));
  reserve(s, { ...r, id: "invalid" }, paid);
  finish(s, "invalid", -1);
  expect(s.totalMicroUsd).toBe(50000 + 2 * maximumMicroUsd(paid));
});
it("retains money after lease expiry and JSON persistence", () => {
  const s = newState(now);
  reserve(s, r, paid);
  const reloaded = JSON.parse(JSON.stringify(s));
  expect(reserve(reloaded, { ...r, id: "next", now: now + 300000 }, paid).ok).toBe(true);
  expect(reloaded.totalMicroUsd).toBe(2 * maximumMicroUsd(paid));
});
it("resets daily budgets at UTC midnight but preserves total and active reservations", () => {
  const late = Date.UTC(2026, 8, 9, 23, 59, 59);
  const s = newState(late);
  reserve(s, { ...r, now: late }, paid);
  finish(s, r.id, 50000, late + 2000);
  expect(s.day).toBe("2026-09-10");
  expect(s.dailyMicroUsd).toBe(50000);
  expect(s.totalMicroUsd).toBe(50000);
  expect(s.dailyIps).toEqual({});
  reserve(s, { ...r, id: "tomorrow", now: late + 86402000 }, paid);
  expect(s.dailyMicroUsd).toBe(maximumMicroUsd(paid));
  expect(s.totalMicroUsd).toBe(50000 + maximumMicroUsd(paid));
});
it("migrates old token-only counters without resetting outstanding consumption", () => {
  const s = newState(now);
  delete s.totalMicroUsd; delete s.dailyMicroUsd; delete s.dailyIps;
  s.tokens = 100000;
  s.ips.hash = { count: 2, expires: now + 10000 };
  reserve(s, r, paid);
  expect(s.totalMicroUsd).toBe(375000 + maximumMicroUsd(paid));
  expect(s.dailyIps!.hash).toBe(3);
});
it("fails closed when monetary limits are enabled with missing prices or another provider", () => {
  expect(() => config({ AI_BUDGET_ENABLED: "true" })).toThrow();
  expect(() => config({ AI_BUDGET_ENABLED: "true", AI_PROVIDER: "openai", AI_INPUT_PRICE_USD_PER_MILLION: "1", AI_OUTPUT_PRICE_USD_PER_MILLION: "1" })).toThrow();
});
