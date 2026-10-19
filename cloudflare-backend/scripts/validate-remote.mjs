import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "https://design-scraper-phase8.lucas-malizia27.workers.dev";
const frontendOrigin = process.env.FRONTEND_ORIGIN || "https://design-scraper.pages.dev";
const results = [];
for (const test of [
  { name: "health", path: "/health", method: "GET", status: 200 },
  { name: "public provider catalog", path: "/api/providers", method: "GET", status: 200 },
  { name: "BYOK incomplete credential rejected before capture", path: "/api/analyze", status: 422, code: "BYOK_INVALID_KEY", headers: { "x-ai-provider": "gemini" }, body: { url: "https://example.com" } },
  { name: "BYOK arbitrary provider rejected before capture", path: "/api/analyze", status: 422, code: "BYOK_INVALID_PROVIDER", headers: { "x-ai-provider": "https://evil.example", "x-ai-key": "qa-not-a-real-key" }, body: { url: "https://example.com" } },
  { name: "public session compatibility", path: "/api/session", method: "GET", status: 200 },
  { name: "budget requires administrative authentication", path: "/api/diagnostics/budget", method: "GET", status: 401, code: "UNAUTHORIZED" },
  { name: "capture diagnostics disabled", path: "/api/diagnostics/capture", status: 404, code: "NOT_FOUND" },
  {
    name: "public input validation without authentication",
    path: "/api/analyze",
    status: 422,
    code: "UNSAFE_URL",
  },
  {
    name: "private URL",
    path: "/api/analyze",
    status: 422,
    code: "UNSAFE_URL",
    body: { url: "http://127.0.0.1/" },
  },
  {
    name: "invalid bias",
    path: "/api/mix",
    status: 422,
    code: "INVALID_REQUEST",
    body: {
      url_1: "https://example.com",
      url_2: "https://example.org",
      bias: 1,
    },
  },
  {
    name: "client secret rejected",
    path: "/api/analyze",
    status: 422,
    code: "INVALID_REQUEST",
    body: { url: "https://example.com", api_key: "test-not-a-key" },
  },
]) {
  const response = await fetch(new URL(test.path, origin), {
    method: test.method || "POST",
    headers: {
      "content-type": "application/json",
      ...test.headers,
    },
    ...(test.method === "GET" ? {} : { body: JSON.stringify(test.body || {}) }),
  });
  const body = await response.json();
  if (test.path === "/api/providers") {
    assert.deepEqual(body.providers.map(p => p.provider), ["gemini", "anthropic", "openai", "xai"]);
    assert.ok(body.providers.every(p => !Object.hasOwn(p, "key")));
  }
  assert.equal(response.status, test.status);
  if (test.code) assert.equal(body.detail?.code, test.code);
  results.push({
    test: test.name,
    status: response.status,
    code: body.detail?.code || null,
  });
}
for (const allowed of [true, false]) {
  const r = await fetch(new URL("/api/analyze", origin), {
    method: "OPTIONS",
    headers: {
      origin: allowed
        ? frontendOrigin
        : "https://localhost.evil.example",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(r.status, 204);
  if (allowed) assert.match(r.headers.get("access-control-allow-headers"), /X-AI-Key/);
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    allowed ? frontendOrigin : null,
  );
  results.push({
    test: allowed ? "exact CORS accepted" : "other origin excluded",
    status: r.status,
  });
}
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/remote-validation.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
