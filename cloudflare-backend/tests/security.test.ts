import { it, expect, vi } from "vitest";
import { targetUrl, publicAddress, PublicNetwork } from "../src/url-safety";
import { boundedText, errorResponse } from "../src/errors";
import { config } from "../src/config";
import worker from "../src/index";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

it("keeps server credential configuration out of frontend source", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk(fileURLToPath(new URL("../../frontend/src", import.meta.url))))
    expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:GEMINI|ANTHROPIC|OPENAI|XAI)_API_KEY/);
});
it.each([
  { contentType: "text/plain", body: "{}", status: 415 },
  { contentType: "application/json", body: "{", status: 422 },
  { contentType: "application/json", body: "x".repeat(16385), status: 413 },
] as const)("rejects invalid HTTP input before admission with status $status", async ({ contentType, body, status }) => {
  const r = await worker.fetch(new Request("https://test/api/analyze", {
    method: "POST", headers: { Authorization: "Bearer test-access", "Content-Type": contentType }, body,
  }), { REQUIRE_AUTH: "true", PHASE8_AUTH_TOKEN: "test-access" } as never);
  expect(r.status).toBe(status);
});
it.each([
  "http://127.1",
  "http://2130706433",
  "http://0x7f000001",
  "http://10.0.0.1",
  "http://[::1]",
  "http://[::ffff:7f00:1]",
  "http://[64:ff9b::7f00:1]",
  "http://169.254.169.254",
  "http://host.internal",
  "http://metadata",
  "http://user:pass@example.com",
  "file:///tmp/x",
  "http://example.com:8080",
])("blocks %s", (url) => expect(() => targetUrl(url)).toThrow());
it("allows arbitrary public asset hosts", () => {
  expect(targetUrl("https://fonts.gstatic.com/a.woff2").hostname).toBe(
    "fonts.gstatic.com",
  );
  expect(publicAddress("8.8.8.8")).toBe(true);
  expect(publicAddress("2606:4700:4700::1111")).toBe(true);
});
it("blocks private answers and rebinding", async () => {
  let ip = "8.8.8.8";
  const f = vi.fn(async (u: URL) =>
    Response.json({
      Status: 0,
      Answer: u.searchParams.get("type") === "A" ? [{ type: 1, data: ip }] : [],
    }),
  );
  const p = new PublicNetwork(f as unknown as typeof fetch);
  await p.validate("https://cdn.example.com");
  p.audit("https://cdn.example.com/a.css", "8.8.8.8");
  ip = "127.0.0.1";
  await expect(
    p.validate("https://cdn.example.com/a.css"),
  ).rejects.toMatchObject({ code: "UNSAFE_URL" });
  expect(() => p.audit("https://cdn.example.com", "10.0.0.1")).toThrow();
});
it("fails closed when DNS cannot be validated", async () => {
  const p = new PublicNetwork(
    vi.fn(async () => Response.json({ Status: 2 })) as typeof fetch,
  );
  await expect(p.validate("https://cdn.example.com")).rejects.toMatchObject({
    code: "DNS_VALIDATION_FAILED",
  });
});
it("enforces streamed size limits even without Content-Length", async () => {
  await expect(
    boundedText(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(50));
            c.close();
          },
        }),
      ),
      10,
    ),
  ).rejects.toMatchObject({ status: 413 });
});
it("never serializes raw errors or secrets", async () => {
  expect(
    await errorResponse(new Error("secret-key website url")).text(),
  ).not.toMatch(/secret-key|website url/);
});
it("requires exact CORS origins on failures too", async () => {
  const env = {
    ALLOWED_ORIGINS: "https://app.example.com",
    REQUIRE_AUTH: "true",
  } as never;
  const r = await worker.fetch(
    new Request("https://api.example.com/api/analyze", {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    }),
    env,
  );
  expect(r.status).toBe(401);
  expect(r.headers.get("access-control-allow-origin")).toBe(
    "https://app.example.com",
  );
  const other = await worker.fetch(
    new Request("https://api.example.com/api/analyze", {
      method: "POST",
      headers: { origin: "https://app.example.com.evil.test" },
    }),
    env,
  );
  expect(other.headers.has("access-control-allow-origin")).toBe(false);
  expect(() => config({ ALLOWED_ORIGINS: "*" })).toThrow();
});

it("keeps capture diagnostics inaccessible without authentication and when public mode is enabled", async () => {
  for (const [requireAuth, expected] of [
    ["true", 401],
    ["false", 404],
  ] as const) {
    const r = await worker.fetch(
      new Request("https://test/api/diagnostics/capture", { method: "POST" }),
      { REQUIRE_AUTH: requireAuth } as never,
    );
    expect(r.status).toBe(expected);
  }
});

it("verifies preview access without capturing or exposing secrets", async () => {
  const env = { REQUIRE_AUTH: "true", PHASE8_AUTH_TOKEN: "access-test", ALLOWED_ORIGINS: "https://preview.example" } as never;
  for (const [token, status] of [["wrong", 401], ["access-test", 200]] as const) {
    const r = await worker.fetch(new Request("https://api.example/api/session", { headers: { Authorization: `Bearer ${token}`, Origin: "https://preview.example" } }), env);
    expect(r.status).toBe(status);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).not.toContain("access-test");
  }
  const budget = await worker.fetch(new Request("https://api.example/api/diagnostics/budget"), env);
  expect(budget.status).toBe(401);
});

it("accepts bounded long asset URLs without widening analysis input", async () => {
  const asset = `https://cdn.example.com/a?value=${'x'.repeat(3000)}`;
  expect(() => targetUrl(asset)).toThrow();
  expect(targetUrl(asset, 16384).hostname).toBe('cdn.example.com');
  expect(() => targetUrl(`https://cdn.example.com/${'x'.repeat(16384)}`, 16384)).toThrow();
  expect(() => targetUrl(`http://127.0.0.1/${'x'.repeat(3000)}`, 16384)).toThrow();
});
it("accepts public CDN rotation but rejects a mixed public/private answer and unaudited peers", async () => {
  let addresses = ['8.8.8.8'];
  const f = vi.fn(async (u: URL) => Response.json({ Status: 0,
    Answer: u.searchParams.get('type') === 'A' ? addresses.map(data => ({type: 1, data})) : [] }));
  const policy = new PublicNetwork(f as unknown as typeof fetch);
  await policy.validate('https://cdn.example.com/a.css');
  addresses = ['1.1.1.1'];
  await policy.validate('https://cdn.example.com/b.css');
  policy.audit('https://cdn.example.com/a.css', '8.8.8.8');
  policy.audit('https://cdn.example.com/b.css', '1.1.1.1');
  expect(() => policy.audit('https://cdn.example.com/c.css', '9.9.9.9')).toThrow();
  addresses = ['8.8.8.8', '10.0.0.1'];
  await expect(policy.validate('https://cdn.example.com/c.css')).rejects.toMatchObject({code: 'UNSAFE_URL'});
});
