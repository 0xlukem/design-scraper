import { afterEach, expect, it, vi } from "vitest";
import { AnalysisSession, type RuntimeEnv } from "../src/index";
import { capture } from "../src/capture";
import fixtures from "./fixtures/contracts.json";
import type { Source } from "../src/domain/normalize";
import { config } from "../src/config";
import { analyze } from "../src/providers";
import { providerSettings } from "../src/byok";

vi.mock("../src/browser-session", () => ({ withBrowser: vi.fn(async (_binding, _signal, callback) => callback({})) }));
vi.mock("../src/capture", () => ({ capture: vi.fn(async () => ({ screenshot: "YWJj", data: fixtures[0].sources[0].data, metrics: { requests: 1, external_hosts: 0 } })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ownKey = "byok-session-test-secret";
const sources = () => structuredClone(fixtures[0].sources) as Source[];
const scoped = providerSettings({ GEMINI_API_KEY: "shared-key", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75" }, { provider: "openai", key: ownKey });

it("keeps BYOK credentials out of capture, results, logs and ledger settlement", async () => {
  const finish = vi.fn();
  const env = {
    GEMINI_API_KEY: "shared-secret", GEMINI_PAUSED_UNTIL: "2099-01-01", AI_PROVIDER: "gemini",
    QUOTA: { getByName: vi.fn(() => ({ providerCall: vi.fn(async () => {}), browserStart: vi.fn(async () => 0), finish })) },
    BROWSER: { fetch: vi.fn() },
  } as unknown as RuntimeEnv;
  const fetcher = vi.fn(async (_url, init) => {
    expect(_url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${ownKey}`);
    expect(init.redirect).toBe("manual");
    expect(String(init.body)).not.toContain(ownKey);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(fixtures[0].raw) }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
  });
  vi.stubGlobal("fetch", fetcher);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const session = new AnalysisSession({ storage: {} } as DurableObjectState, env);
  const response = await session.run(sources(), "id", null, false, { provider: "openai", key: ownKey });
  const payload = await response.json() as { metadata: { usage: Record<string, unknown> }; documents: unknown };
  expect(response.status).toBe(200);
  expect(payload.metadata.usage).toMatchObject({ provider: "openai", funding: "byok", estimated_cost_usd: null, cost_status: "unavailable" });
  expect(payload.documents).toEqual(fixtures[0].documents);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.stringify(payload)).not.toContain(ownKey);
  expect(JSON.stringify(log.mock.calls)).not.toContain(ownKey);
  expect(JSON.stringify(finish.mock.calls)).not.toContain(ownKey);
  expect(JSON.stringify(vi.mocked(capture).mock.calls)).not.toContain(ownKey);
  expect(env.GEMINI_API_KEY).toBe("shared-secret");
});
it.each([401, 429, 503])("returns safe BYOK provider errors (%s) with exactly one attempt", async status => {
  const f = vi.fn(async () => Response.json({ error: { message: `unsafe upstream ${ownKey}` } }, { status }));
  const c = { ...config({}), attempts: 1, budgetEnabled: false };
  const run = analyze(sources(), scoped, c, AbortSignal.timeout(10000), f);
  await expect(run).rejects.toMatchObject({ message: expect.not.stringContaining(ownKey) });
  expect(f).toHaveBeenCalledOnce();
});
it("BYOK Gemini counts multimodal input even though its shared monetary guard is disabled", async () => {
  const env = providerSettings({}, { provider: "gemini", key: ownKey });
  const f = vi.fn(async (_url, init) => {
    expect(String(_url)).toMatch(/:countTokens$/);
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(ownKey);
    return Response.json({ totalTokens: 1000000 });
  });
  await expect(analyze(sources(), env, { ...config({}), attempts: 1, budgetEnabled: false }, AbortSignal.timeout(10000), f))
    .rejects.toMatchObject({ code: "AI_INPUT_LIMIT", budgetTokens: 0 });
  expect(f).toHaveBeenCalledOnce();
});

it.each([
  ["auth", "PROVIDER_AUTH_ERROR", 503],
  ["quota", "PROVIDER_QUOTA_EXHAUSTED", 429],
  ["unavailable", "PROVIDER_TEMPORARILY_UNAVAILABLE", 503],
  ["rejected", "PROVIDER_REQUEST_REJECTED", 502],
  ["network", "PROVIDER_TEMPORARILY_UNAVAILABLE", 503],
  ["invalid-json", "AI_FAILED", 502],
  ["timeout", "AI_TIMEOUT", 504],
  ["capture", "INTERNAL_ERROR", 500],
] as const)("never leaks a credential through a failed %s session", async (scenario, code, status) => {
  const secret = `fake-byok-failure-${scenario}-sentinel`;
  const finish = vi.fn();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = { put: vi.fn(), sql: { exec: vi.fn() } };
  const env = {
    GEMINI_API_KEY: "fake-shared-key-must-not-be-used", AI_PROVIDER: "gemini",
    AI_ATTEMPT_TIMEOUT_MS: "1000",
    QUOTA: { getByName: vi.fn(() => ({ providerCall: vi.fn(async () => {}), browserStart: vi.fn(async () => 0), finish })) },
    BROWSER: { fetch: vi.fn() },
  } as unknown as RuntimeEnv;
  if (scenario === "capture") vi.mocked(capture).mockRejectedValueOnce(new Error(`Capture error containing ${secret}`));
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    expect(init?.redirect).toBe("manual");
    expect(String(init?.body)).not.toContain(secret);
    if (scenario === "network") throw new Error(`Network error containing ${secret}`);
    if (scenario === "invalid-json") return new Response(`Invalid JSON containing ${secret}`);
    if (scenario === "timeout") return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(`Timeout containing ${secret}`)), { once: true });
    });
    const upstreamStatus = scenario === "auth" ? 401 : scenario === "quota" ? 429 : scenario === "rejected" ? 400 : 503;
    return Response.json({ error: { message: `Upstream body containing ${secret}` } }, { status: upstreamStatus });
  });
  vi.stubGlobal("fetch", fetcher);
  const session = new AnalysisSession({ storage } as unknown as DurableObjectState, env);
  const response = await session.run(sources(), "failure-id", null, false, { provider: "openai", key: secret });
  expect(response.status).toBe(status);
  const payload = await response.json();
  expect(payload).toMatchObject({ detail: { code } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).toHaveBeenCalledTimes(scenario === "capture" ? 0 : 1);
  expect(finish).toHaveBeenCalledOnce();
  const observable = JSON.stringify([payload, [...response.headers], log.mock.calls, warning.mock.calls, error.mock.calls, finish.mock.calls, vi.mocked(capture).mock.calls]);
  expect(observable).not.toContain(secret);
  expect(observable).not.toContain(env.GEMINI_API_KEY);
  expect(storage.put).not.toHaveBeenCalled();
  expect(storage.sql.exec).not.toHaveBeenCalled();
});

it("keeps two concurrent sessions' keys isolated through delayed provider responses", async () => {
  const finish = vi.fn();
  const env = {
    GEMINI_API_KEY: "fake-shared-key", AI_PROVIDER: "gemini",
    QUOTA: { getByName: vi.fn(() => ({ providerCall: vi.fn(async () => {}), browserStart: vi.fn(async () => 0), finish })) },
    BROWSER: { fetch: vi.fn() },
  } as unknown as RuntimeEnv;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const keys = ["fake-concurrent-user-a-key", "fake-concurrent-user-b-key"];
  const pending: Array<{ key: string | null; complete: () => void }> = [];
  let bothArrived!: () => void;
  const ready = new Promise<void>(resolve => { bothArrived = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>(resolve => {
    pending.push({ key: new Headers(init?.headers).get("authorization"), complete: () => resolve(Response.json({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(fixtures[0].raw) }] }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    })) });
    if (pending.length === 2) bothArrived();
  }));
  vi.stubGlobal("fetch", fetcher);
  // Admission concurrency is covered by the ledger tests. Independent objects
  // here deliberately overlap to test request-scoped credential isolation.
  const work = keys.map((key, i) => new AnalysisSession({ storage: {} } as DurableObjectState, env)
    .run(sources(), `session-${i}`, null, false, { provider: "openai", key }));
  await ready;
  expect(pending.map(p => p.key).sort()).toEqual(keys.map(key => `Bearer ${key}`).sort());
  pending[1].complete();
  pending[0].complete();
  const responses = await Promise.all(work);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const observable = JSON.stringify([await Promise.all(responses.map(r => r.json())), log.mock.calls, finish.mock.calls, env.GEMINI_API_KEY]);
  for (const key of keys) expect(observable).not.toContain(key);
  expect(env.GEMINI_API_KEY).toBe("fake-shared-key");
});

it.each([-50, 50])("captures only the included source for bias %s and keeps all five outputs", async bias => {
  const fixture = fixtures.find(f => f.bias === bias)!;
  const input = structuredClone(fixture.sources) as Source[];
  const finish = vi.fn();
  const env = { QUOTA: { getByName: vi.fn(() => ({providerCall: vi.fn(async () => {}), browserStart: vi.fn(async () => 0), finish})) }, BROWSER: {fetch: vi.fn()} } as unknown as RuntimeEnv;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fetcher = vi.fn(async () => Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(fixture.raw)}]}],usage:{input_tokens:10,output_tokens:20,total_tokens:30}}));
  vi.stubGlobal('fetch',fetcher);
  vi.mocked(capture).mockClear();
  const result = await new AnalysisSession({storage:{}} as DurableObjectState,env).run(input,'bias',bias,false,{provider:'openai',key:ownKey});
  expect(result.status).toBe(200);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(vi.mocked(capture).mock.calls[0][1]).toBe(input.find(s=>s.weight>0)!.url);
  const output = await result.json() as {documents:unknown;exports:unknown};
  expect(output.documents).toEqual(fixture.documents);
  expect(output.exports).toEqual(fixture.exports);
  expect(JSON.stringify(log.mock.calls)).not.toContain(ownKey);
});
