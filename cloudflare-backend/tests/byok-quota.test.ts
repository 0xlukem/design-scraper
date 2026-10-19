import { expect, it } from "vitest";
import { config } from "../src/config";
import { newState, reserve, settle } from "../src/quota";
const now = Date.UTC(2026, 8, 10, 10);
const c = config({ AI_BUDGET_ENABLED: "true", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75" });
const request = { id: "byok", ip: "hash", sources: 2, now, provider: "gemini", version: "1", funding: "byok" as const };
const result = { browserMs: 1234, tokens: 1000, microUsd: 5000, provider: "gemini", version: "1" };
it("admits BYOK with exhausted demo budgets and blocked demo credentials, preserving all three", () => {
  const s = newState(now);
  s.tokens = c.dailyTokens + 10;
  s.totalMicroUsd = c.totalMicroUsd + 10;
  s.dailyMicroUsd = c.dailyMicroUsd + 10;
  s.circuits.gemini = { failures: 1, until: now, permanent: true, version: "1" };
  const before = structuredClone(s);
  expect(reserve(s, request, c)).toEqual({ ok: true });
  expect(s.leases.byok).toMatchObject({ browser: 80000, tokens: 0, microUsd: 0, funding: "byok" });
  settle(s, "byok", { ...result, success: true }, c, now + 1000);
  expect(s.tokens).toBe(before.tokens);
  expect(s.totalMicroUsd).toBe(before.totalMicroUsd);
  expect(s.dailyMicroUsd).toBe(before.dailyMicroUsd);
  expect(s.circuits).toEqual(before.circuits);
  expect(s.browser).toBe(1234);
  expect(s.count).toBe(1);
  expect(s.dailyIps!.hash).toBe(1);
});
it.each(["configuration", "quota", "transient"] as const)("BYOK %s failure never opens the shared circuit", failure => {
  const s = newState(now);
  reserve(s, request, c);
  settle(s, "byok", { ...result, failure }, c, now + 1000);
  expect(s.circuits).toEqual({});
  expect(reserve(s, { ...request, id: "demo", sources: 1, funding: "demo" }, c)).toEqual({ ok: true });
});
it.each([
  ["RATE_LIMITED", (s: ReturnType<typeof newState>) => { s.ips.hash = { count: c.ipHourly, expires: now + 10000 }; }],
  ["IP_DAILY_LIMIT_REACHED", (s: ReturnType<typeof newState>) => { s.dailyIps!.hash = c.ipDaily; }],
  ["DAILY_LIMIT_REACHED", (s: ReturnType<typeof newState>) => { s.count = c.daily; }],
  ["BROWSER_QUOTA_EXHAUSTED", (s: ReturnType<typeof newState>) => { s.browser = c.browserDaily; }],
  ["CAPACITY_REACHED", (s: ReturnType<typeof newState>) => { reserve(s, { ...request, id: "other" }, c); }],
] as const)("BYOK still enforces %s", (code, prepare) => {
  const s = newState(now); prepare(s);
  expect(reserve(s, request, c)).toMatchObject({ ok: false, code });
});
it("settles a BYOK lease after JSON persistence and midnight without charging the demo", () => {
  const late = Date.UTC(2026, 8, 10, 23, 59, 59);
  const s = newState(late);
  s.totalMicroUsd = 9000;
  reserve(s, { ...request, now: late }, c);
  const persisted = JSON.parse(JSON.stringify(s));
  settle(persisted, "byok", result, c, late + 2000);
  expect(persisted).toMatchObject({ totalMicroUsd: 9000, dailyMicroUsd: 0, tokens: 0, browser: 1234 });
});
it("retains the maximum browser reservation on unknown BYOK failure or expiry", () => {
  const s = newState(now);
  reserve(s, request, c);
  settle(s, "byok", { ...result, browserMs: null, tokens: null, microUsd: null }, c, now + 1000);
  expect(s).toMatchObject({ browser: 80000, tokens: 0, totalMicroUsd: 0 });
});
