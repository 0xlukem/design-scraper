import { expect, it, vi } from "vitest";
import worker, { type RuntimeEnv } from "../src/index";

function runtime() {
  const admit = vi.fn().mockResolvedValue({ ok: true });
  const run = vi.fn().mockResolvedValue(Response.json({ success: true, design_md: "# Fixture" }));
  const status = vi.fn().mockResolvedValue({ dailyLimit: 20 });
  const env = {
    REQUIRE_AUTH: "false", AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-provider-key",
    IP_HASH_SECRET: "test-ip-hash-secret", PHASE8_AUTH_TOKEN: "test-admin-token",
    QUOTA: { getByName: vi.fn().mockReturnValue({ admit, status }) },
    ANALYSIS: { getByName: vi.fn().mockReturnValue({ fetch: run }) },
  } as unknown as RuntimeEnv;
  return { env, admit, run, status };
}
const requests = [
  { path: "/api/analyze", body: { url: "https://one.example" }, sources: 1 },
  { path: "/api/mix", body: { url_1: "https://one.example", url_2: "https://two.example", bias: 0 }, sources: 2 },
];
function request(path: string, body: unknown) {
  return new Request(`https://api.example${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "8.8.8.8" },
    body: JSON.stringify(body),
  });
}
for (const { path, body, sources } of requests) {
  it(`admits ${path} without a visitor credential through the shared quota ledger`, async () => {
    const { env, admit, run } = runtime();
    const response = await worker.fetch(request(path, body), env);
    expect(response.status).toBe(200);
    expect(env.QUOTA.getByName).toHaveBeenCalledWith("global-budget-v1");
    expect(admit).toHaveBeenCalledOnce();
    expect(admit.mock.calls[0][0]).toMatchObject({ sources, provider: "gemini" });
    expect(admit.mock.calls[0][0].ip).toMatch(/^[a-f0-9]{64}$/);
    expect(run).toHaveBeenCalledOnce();
  });
  it.each([
    "RATE_LIMITED", "IP_DAILY_LIMIT_REACHED", "DAILY_LIMIT_REACHED",
    "DAILY_AI_BUDGET_EXHAUSTED", "PROJECT_BUDGET_EXHAUSTED",
    "BROWSER_QUOTA_EXHAUSTED", "CAPACITY_REACHED",
  ])(`keeps ${path} blocked by %s without starting an analysis`, async code => {
    const { env, admit, run } = runtime();
    admit.mockResolvedValue({ ok: false, code, status: 429, retryAfter: 60 });
    const response = await worker.fetch(request(path, body), env);
    expect(response.status).toBe(429);
    expect((await response.json() as { detail: { code: string } }).detail.code).toBe(code);
    expect(run).not.toHaveBeenCalled();
  });
}
it.each([undefined, "wrong", "test-admin-token"])("keeps budget diagnostics authenticated in public mode (%s)", async token => {
  const { env, status } = runtime();
  const response = await worker.fetch(new Request("https://api.example/api/diagnostics/budget", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), env);
  expect(response.status).toBe(token === "test-admin-token" ? 200 : 401);
  expect(status).toHaveBeenCalledTimes(token === "test-admin-token" ? 1 : 0);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("test-admin-token");
});

it('exposes only the minimal public quota projection, not protected spending or identifiers', async () => {
  const { env, status, run, admit } = runtime();
  const publicStatus = vi.fn().mockResolvedValue({ analyses: { remaining: 18 }, capture: { remaining_ms: 1000 } });
  vi.mocked(env.QUOTA.getByName).mockReturnValue({ publicStatus } as never);
  const response = await worker.fetch(new Request('https://api.example/api/quotas'), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ analyses: { remaining: 18 }, capture: { remaining_ms: 1000 } });
  expect(status).not.toHaveBeenCalled();
  expect(admit).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it('confirms zero provider calls when admission is rejected', async () => {
  const { env, admit } = runtime();
  admit.mockResolvedValue({ ok: false, code: 'CAPACITY_REACHED', status: 503, retryAfter: 5 });
  const response = await worker.fetch(request('/api/analyze', { url: 'https://example.com' }), env);
  expect(await response.json()).toMatchObject({ telemetry: { provider_calls: 0, final: true, usage_status: 'not_called', demo_budget: null } });
});
it('does not offer timed retry for a permanently disabled demo provider', async () => {
  const { env, admit, run } = runtime();
  admit.mockResolvedValue({ ok: false, code: 'PROVIDER_UNAVAILABLE', status: 503, retryAfter: 1 });
  const response = await worker.fetch(request('/api/analyze', { url: 'https://example.com' }), env);
  expect(response.status).toBe(503);
  expect(response.headers.has('retry-after')).toBe(false);
  expect(await response.json()).toMatchObject({ detail: { code: 'PROVIDER_UNAVAILABLE', retryable: false } });
  expect(run).not.toHaveBeenCalled();
});
it('preserves the retry deadline for a temporary provider circuit', async () => {
  const { env, admit, run } = runtime();
  admit.mockResolvedValue({ ok: false, code: 'PROVIDER_CIRCUIT_OPEN', status: 503, retryAfter: 60 });
  const response = await worker.fetch(request('/api/analyze', { url: 'https://example.com' }), env);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(await response.json()).toMatchObject({ detail: { code: 'PROVIDER_CIRCUIT_OPEN', retryable: true } });
  expect(run).not.toHaveBeenCalled();
});
it('forwards stream negotiation without moving a BYOK credential into JSON', async () => {
  const { env, run } = runtime();
  const req = request('/api/analyze', { url: 'https://example.com' });
  req.headers.set('accept', 'application/x-ndjson');
  req.headers.set('x-ai-provider', 'openai'); req.headers.set('x-ai-key', 'fake-stream-key');
  await worker.fetch(req, env);
  expect(run.mock.calls[0][1].headers).toMatchObject({ accept: 'application/x-ndjson', 'x-ai-key': 'fake-stream-key' });
  expect(run.mock.calls[0][1].body).not.toContain('fake-stream-key');
});
