import { expect, it, vi } from "vitest";
import worker, { type RuntimeEnv } from "../src/index";
import { providerCatalog, providerSettings, requestCredentials, providers } from "../src/byok";
import { providerConfig } from "../src/providers";

const ownKey = "byok-test-secret-never-persist";
function runtime() {
  const admit = vi.fn().mockResolvedValue({ ok: true });
  const run = vi.fn().mockResolvedValue(Response.json({ success: true }));
  const env = {
    REQUIRE_AUTH: "false", AI_PROVIDER: "gemini", GEMINI_API_KEY: "shared-secret",
    IP_HASH_SECRET: "ip-secret", PHASE8_AUTH_TOKEN: "admin-secret",
    GEMINI_PAUSED_UNTIL: "2099-01-01", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75",
    QUOTA: { getByName: vi.fn().mockReturnValue({ admit }) },
    ANALYSIS: { getByName: vi.fn().mockReturnValue({ fetch: run }) },
  } as unknown as RuntimeEnv;
  return { env, admit, run };
}
function request(headers: Record<string, string> = {}, url = "https://api.example/api/analyze", body: unknown = { url: "https://example.com" }) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "8.8.8.8", ...headers }, body: JSON.stringify(body) });
}
it.each(providers)("admits %s BYOK without requiring a shared key or using its pause", async provider => {
  const { env, admit, run } = runtime();
  Reflect.deleteProperty(env, "GEMINI_API_KEY");
  const response = await worker.fetch(request({ "x-ai-provider": provider, "x-ai-key": ownKey }), env);
  expect(response.status).toBe(200);
  expect(admit.mock.calls[0][0]).toMatchObject({ provider, funding: "byok" });
  expect(JSON.stringify(admit.mock.calls)).not.toContain(ownKey);
  const [url, init] = run.mock.calls[0];
  expect(url).toBe("https://analysis.internal/run");
  expect(init.headers).toEqual({ "x-ai-provider": provider, "x-ai-key": ownKey });
  expect(init.body).not.toContain(ownKey);
  expect(await response.text()).not.toContain(ownKey);
});
it.each([
  [{ "x-ai-provider": "gemini" }, "BYOK_INVALID_KEY"],
  [{ "x-ai-key": ownKey }, "BYOK_INVALID_PROVIDER"],
  [{ "x-ai-provider": "https://evil.example", "x-ai-key": ownKey }, "BYOK_INVALID_PROVIDER"],
  [{ "x-ai-provider": "groq", "x-ai-key": ownKey }, "BYOK_INVALID_PROVIDER"],
  [{ "x-ai-provider": "gemini", "x-ai-key": "" }, "BYOK_INVALID_KEY"],
  [{ "x-ai-provider": "gemini", "x-ai-key": "invalid key" }, "BYOK_INVALID_KEY"],
  [{ "x-ai-provider": "gemini", "x-ai-key": "a".repeat(513) }, "BYOK_INVALID_KEY"],
] as const)("rejects malformed BYOK before admission", async (headers, code) => {
  const { env, admit, run } = runtime();
  const response = await worker.fetch(request(headers), env);
  expect((await response.json() as { detail: { code: string } }).detail.code).toBe(code);
  expect(admit).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
it("requires actual HTTPS, ignoring a spoofed forwarded-proto header", () => {
  expect(() => requestCredentials(request({ "x-ai-provider": "gemini", "x-ai-key": ownKey, "x-forwarded-proto": "https" }, "http://api.example/api/analyze")))
    .toThrow(expect.objectContaining({ code: "BYOK_HTTPS_REQUIRED" }));
});
it.each(["api_key", "provider", "model", "base_url"])("rejects client field %s without a fallback", async field => {
  const { env, admit } = runtime();
  const response = await worker.fetch(request({ "x-ai-provider": "gemini", "x-ai-key": ownKey }, undefined, { url: "https://example.com", [field]: "client-controlled" }), env);
  expect(response.status).toBe(422);
  expect(admit).not.toHaveBeenCalled();
});
it("does not copy shared secrets, pauses or Gemini prices into another provider's settings", () => {
  const env = { GEMINI_API_KEY: "shared", AI_PROVIDER: "gemini", ANTHROPIC_PAUSED_UNTIL: "2099-01-01", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75" };
  const scoped = providerSettings(env, { provider: "anthropic", key: ownKey });
  expect(providerConfig(scoped)).toMatchObject({ provider: "anthropic", key: ownKey, model: "claude-sonnet-4-6" });
  expect(scoped.GEMINI_API_KEY).toBeUndefined();
  expect(scoped.ANTHROPIC_PAUSED_UNTIL).toBeUndefined();
  expect(scoped.AI_INPUT_PRICE_USD_PER_MILLION).toBeUndefined();
  expect(env.GEMINI_API_KEY).toBe("shared");
  const catalog = providerCatalog(env);
  expect(catalog[0]).toMatchObject({ inputPrice: 0.75, outputPrice: 3.75 });
  expect(catalog[1]).toMatchObject({ inputPrice: null, outputPrice: null });
  expect(JSON.stringify(catalog)).not.toContain(ownKey);
});
it("allows BYOK preflight only for the exact configured origin", async () => {
  const { env } = runtime();
  for (const origin of ["http://localhost:5173", "https://evil.example"]) {
    const r = await worker.fetch(new Request("https://api.example/api/analyze", { method: "OPTIONS", headers: { origin, "access-control-request-headers": "x-ai-provider,x-ai-key,content-type" } }), env);
    expect(r.headers.get("access-control-allow-origin")).toBe(origin.includes("localhost") ? origin : null);
    if (origin.includes("localhost")) expect(r.headers.get("access-control-allow-headers")).toContain("X-AI-Key");
  }
});
