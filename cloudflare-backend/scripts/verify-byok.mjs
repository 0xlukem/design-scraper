// Browser QA with intercepted API by default. --live is an explicitly budgeted
// two-analysis Gemini run; no traces/HAR/credentials are written to artifacts.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { isolateReplayNetwork } from "./replay-network.mjs";
import { readAnalysisResponse } from "./read-analysis-response.mjs";
const site = process.env.PAGES_URL || "https://design-scraper.pages.dev";
const api = process.env.API_URL || "https://design-scraper-phase8.lucas-malizia27.workers.dev";
const live = process.argv.includes("--live");
assert.equal(new URL(site).protocol, "https:");
assert.equal(new URL(api).protocol, "https:");
const vars = live ? await readFile(".dev.vars", "utf8") : "";
const secret = name => vars.split(/\r?\n/).find(s => s.startsWith(name + "="))?.slice(name.length + 1).trim();
const key = live ? secret("GEMINI_API_KEY") : "byok-browser-fixture-key";
const admin = live ? secret("PHASE8_AUTH_TOKEN") : null;
if (live) assert.ok(key && admin, "Live QA requires configured Gemini and administrative credentials.");
const budget = async () => {
  const response = await fetch(`${api}/api/diagnostics/budget`, { headers: { Authorization: `Bearer ${admin}` }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  return response.json();
};
const before = live ? await budget() : null;
if (live) {
  assert.equal(before.active, 0);
  assert.equal(before.dailyLimit, 20);
  assert.equal(before.ipHourlyLimit, 3);
  assert.equal(before.ipDailyLimit, 5);
  assert.equal(before.browserMsLimit, 480000);
  assert.ok(before.dailyLimit - before.admitted >= 2);
  assert.ok(before.browserMsLimit - before.browserMsUsedOrReserved >= 120000);
  // Fixed deployed limits, one attempt: 2 * (80k * .75 + 12k * 3.75) = $.21.
  assert.ok(2 * (80000 * 0.75 + 12000 * 3.75) <= 250000);
}
const artifacts = "../output/playwright/byok";
await mkdir(artifacts, { recursive: true });
await mkdir("reports", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"], ignoreHTTPSErrors: process.env.LOCAL_UI_HTTPS === "true", serviceWorkers: "block" });
const unexpectedNetwork = live ? [] : await isolateReplayNetwork(context, site);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], violations = [], checks = [], usage = [];
let analyses = 0, catalogRequests = 0, selected = "gemini", injectedError = null;
page.on("pageerror", e => errors.push(e.message.includes(key) ? "Redacted page error" : e.message));
page.on("console", m => {
  if (m.text().includes(key)) violations.push("Credential in browser console");
  if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text().includes(key) ? "Redacted console error" : m.text());
});
page.on("request", request => {
  const headers = request.headers();
  const url = request.url();
  const analysis = /^\/api\/(analyze|mix)$/.test(new URL(url).pathname) && new URL(url).origin === api && request.method() === "POST";
  if (analysis) {
    analyses++;
    if (headers["x-ai-key"] !== key || headers["x-ai-provider"] !== selected) violations.push("Missing/mismatched BYOK headers");
    if (headers.authorization) violations.push("Unexpected administrative authorization");
  } else if (headers["x-ai-key"]) violations.push("Credential outside an analysis request");
  if (url.includes(key) || (request.postData() || "").includes(key)) violations.push("Credential in URL/body");
});
const fixtures = JSON.parse(await readFile("tests/fixtures/contracts.json", "utf8"));
const catalog = [
  { provider: "gemini", model: "gemini-3.6-flash", inputPrice: 0.75, outputPrice: 3.75 },
  { provider: "anthropic", model: "claude-sonnet-4-6", inputPrice: null, outputPrice: null },
  { provider: "openai", model: "gpt-4o", inputPrice: null, outputPrice: null },
  { provider: "xai", model: "grok-4.3", inputPrice: null, outputPrice: null },
];
if (!live) await page.route("**/api/**", async route => {
  const request = route.request();
  const headers = { "access-control-allow-origin": site, "access-control-allow-headers": "content-type,x-ai-provider,x-ai-key", "access-control-allow-methods": "GET,POST,OPTIONS" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  if (request.url().endsWith("/providers")) { catalogRequests++; return route.fulfill({ headers, json: { providers: catalog } }); }
  if (request.url().endsWith("/quotas")) return route.fulfill({ headers, json: { day: '2026-10-10', resets_at: '2026-10-11T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true } });
  if (injectedError) return route.fulfill({ headers, status: 503, json: { detail: { code: injectedError, message: "Fixture provider error" } } });
  const f = fixtures.find(f => request.url().endsWith("/mix") ? f.bias === 25 : f.bias === null);
  return route.fulfill({ headers, json: {
    success: true, design_md: f.documents.extended, design_system: f.normalized, documents: f.documents, exports: f.exports,
    metadata: { ...(f.bias === null ? { url: f.sources[0].url, title: "BYOK fixture" } : { mode: "mix", bias: 25, weights: { web_1: 25, web_2: 75 }, sources: f.sources.map(s => ({ slot: s.label, url: s.url, influence: s.weight, status: "analyzed", title: "BYOK fixture", description: "", colors_extracted: 1, fonts_extracted: 1 })) }), usage: {
      provider: selected, model: catalog.find(p => p.provider === selected).model, funding: "byok", input_tokens: 100, output_tokens: 200, total_tokens: 300, reasoning_tokens: null, status: "exact", estimated_cost_usd: selected === "gemini" ? 0.001 : null, cost_status: selected === "gemini" ? "estimated" : "unavailable", pricing_source: selected === "gemini" ? "fixture" : null, sources_count: f.sources.length, screenshots_sent: f.sources.length, notes: [],
    } },
  } });
});
async function noStorage() {
  const empty = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie, databases: (await indexedDB.databases()).length }));
  assert.deepEqual(empty, { local: 0, session: 0, cookies: "", databases: 0 });
  assert.equal((await context.cookies()).length, 0);
}
async function configure(provider = "gemini") {
  selected = provider;
  if (!await page.locator("#provider-settings").isVisible()) await page.getByRole("button", { name: /Use my API key|Manage key/, exact: true }).click();
  await page.getByLabel("AI provider", { exact: true }).selectOption(provider);
  await page.getByText(`Model: ${catalog.find(p => p.provider === provider).model}`, { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
  await page.getByLabel("Provider API key", { exact: true }).fill(key);
  await page.getByRole("checkbox", { name: /I understand and accept/ }).check();
  await page.getByRole("button", { name: "Use this key", exact: true }).click();
}
async function outputs(payload, kind) {
  const calls = analyses;
  await page.getByRole("button", { name: "Export design", exact: true }).click();
  for (const [tab, variant, expected, filename] of [
    ["DESIGN.md", "Extended", payload.documents.extended, kind === "mix" ? "mixed-design.md" : "design.md"],
    ["DESIGN.md", "Compact", payload.documents.compact, kind === "mix" ? "mixed-design-compact.md" : "design-compact.md"],
    ["CSS Variables", null, payload.exports.css_variables, "design-variables.css"],
    ["Tailwind v4", null, payload.exports.tailwind, "tailwind-theme.css"],
    ["Design Tokens", null, payload.exports.design_tokens, "tokens.json"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (variant) await page.getByRole("button", { name: variant, exact: true }).click();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download / }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), filename);
    assert.equal(await readFile(await download.path(), "utf8"), expected);
    assert.ok(!expected.includes(key));
    checks.push(`${selected} ${kind}: ${variant || tab} exact copy/download`);
  }
  assert.equal(analyses, calls);
}
try {
  for (const provider of live ? ["gemini"] : catalog.map(p => p.provider)) {
    await page.goto(site);
    await page.getByLabel("Website URL").waitFor();
    await page.getByText("Using Design Scraper · Included", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).count(), 0);
    await configure(provider);
    if (live) {
      const catalogResponse = await context.request.get(`${api}/api/providers`);
      const liveCatalog = await catalogResponse.json();
      assert.deepEqual(liveCatalog.providers[0], catalog[0]);
    }
    assert.match(await page.locator('.key-status').innerText(), /Ready for next analysis/);
    await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
    await page.getByRole('button', { name: /Use my API key|Manage key/, exact: true }).click();
    assert.equal(await page.getByLabel('Provider API key', { exact: true }).inputValue(), key);
    await page.getByRole('button', { name: 'Show key', exact: true }).click();
    assert.equal(await page.getByLabel('Provider API key', { exact: true }).getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Hide key', exact: true }).click();
    for (const width of provider === 'gemini' ? [1440, 768, 390, 320] : [390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.locator('#provider-settings').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
      await page.screenshot({ path: `${artifacts}/key-settings-${provider}-${width}.png`, mask: [page.getByLabel('Provider API key', { exact: true })] });
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: /Use my API key|Manage key/, exact: true }).evaluate(e => e === document.activeElement), true);
    await page.getByRole('link', { name: 'Analyze', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    checks.push(`${provider}: unverified until analysis, shared key state across views, inline editor keyboard and responsive layout`);
    const catalogBefore = catalogRequests;
    for (const kind of ["single", "mix"]) {
      if (kind === "single") await page.getByLabel("Website URL").fill("https://example.com/");
      else {
        await page.getByRole("tab", { name: /Mix It/ }).click();
        await page.getByLabel("First website URL").fill("https://example.com/");
        await page.getByLabel("Second website URL").fill("https://milligram.io/");
        await page.getByLabel("Mix balance").fill("25");
      }
      const resultPromise = page.waitForResponse(r => r.url() === `${api}/api/${kind === "mix" ? "mix" : "analyze"}` && r.request().method() === "POST", { timeout: 195000 });
      await page.getByRole("button", { name: kind === "mix" ? /mix designs/i : /analyze design/i }).click();
      const response = await resultPromise;
      const { type, payload } = await readAnalysisResponse(response);
      assert.equal(response.status(), 200, `BYOK ${kind}: ${payload?.detail?.code || response.status()}`);
      assert.equal(type, 'result', `BYOK ${kind}: ${payload?.detail?.code || 'ANALYSIS_FAILED'}`);
      assert.equal(payload?.success, true);
      assert.equal(payload.metadata.usage.funding, "byok");
      assert.equal(payload.metadata.usage.provider, selected);
      if (kind === "mix") assert.deepEqual(payload.metadata.weights, { web_1: 25, web_2: 75 });
      assert.ok(!JSON.stringify(payload).includes(key));
      await page.locator(".key-status-verified").waitFor();
      if (live) {
        usage.push(payload.metadata.usage);
        await writeFile(`reports/result-byok-${kind}.json`, JSON.stringify(payload, null, 2));
        console.log(JSON.stringify({ kind, status: response.status(), analysisId: response.headers()["x-analysis-id"], usage: payload.metadata.usage }));
      }
      await outputs(payload, kind);
      for (const width of provider === "gemini" ? [1440, 768, 390, 320] : [390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `${artifacts}/${live ? "live" : "replay"}-${provider}-${kind}-${width}-viewport.png`, mask: [page.getByLabel("Provider API key", { exact: true })] });
        await page.screenshot({ path: `${artifacts}/${live ? "live" : "replay"}-${provider}-${kind}-${width}.png`, fullPage: true, mask: [page.getByLabel("Provider API key", { exact: true })] });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    assert.equal(catalogRequests, catalogBefore, "Output actions must not reload providers");
    await noStorage();
    if (!live) {
      injectedError = "PROVIDER_AUTH_ERROR";
      await page.getByRole("button", { name: /mix designs/i }).click();
      await page.getByRole("alert").filter({ hasText: "Your key was rejected" }).waitFor();
      injectedError = null;
      const calls = analyses;
      await page.getByRole("button", { name: /mix designs/i }).click();
      await page.getByRole("alert").filter({ hasText: "3 BYOK attempts per hour" }).waitFor();
      assert.equal(analyses, calls);
      checks.push(`${provider}: provider auth error and local attempt limit`);
    }
    await page.getByRole("button", { name: /Use my API key|Manage key/, exact: true }).click();
    await page.getByRole("button", { name: "Clear key", exact: true }).click();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
    assert.equal(await page.getByRole("checkbox", { name: /I understand and accept/ }).isChecked(), false);
    assert.equal(await page.locator("#analysis-form button[type=submit]").isDisabled(), true);
    await page.getByLabel("Provider API key", { exact: true }).fill(key);
    await page.getByLabel("AI provider", { exact: true }).selectOption(provider === "gemini" ? "openai" : "gemini");
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
    await page.getByLabel("Provider API key", { exact: true }).fill(key);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
    await page.reload();
    await configure(provider);
    await page.getByRole("button", { name: /Use my API key|Manage key/, exact: true }).click();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).getAttribute("autocomplete"), "off");
    await page.getByLabel("AI provider", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).evaluate(e => e === document.activeElement), true);
    assert.ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"));
    await page.getByRole("button", { name: "Use Design Scraper", exact: true }).click();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Use my API key", exact: true }).click();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).inputValue(), "");
    await noStorage();
    checks.push(`${provider}: key clearing, provider switch, navigation, reload, demo switch, keyboard, no browser persistence`);
  }
  const after = live ? await budget() : null;
  if (live) {
    assert.equal(analyses, 2);
    assert.equal(after.totalMicroUsdUsedOrReserved, before.totalMicroUsdUsedOrReserved);
    assert.equal(after.dailyMicroUsdUsedOrReserved, before.dailyMicroUsdUsedOrReserved);
    assert.equal(after.tokensUsedOrReserved, before.tokensUsedOrReserved);
    assert.equal(after.admitted - before.admitted, 2);
    assert.ok(after.browserMsUsedOrReserved - before.browserMsUsedOrReserved <= 180000);
    assert.ok(usage.every(u => u.estimated_cost_usd !== null));
    assert.ok(usage.reduce((sum, u) => sum + u.estimated_cost_usd, 0) <= 0.25);
    checks.push("Two live BYOK analyses: demo money/tokens unchanged; admissions/capture charged; within authorized QA budget");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(unexpectedNetwork, [], "Replay attempted an unmocked external connection");
  await writeFile(`reports/byok-${live ? "live" : "replay"}.json`, JSON.stringify({ site, analyses, checks, before, after, usage, errors, violations, unexpectedNetwork }, null, 2));
  console.log(JSON.stringify({ mode: live ? "byok-live" : "byok-replay", analyses, checks: checks.length, errors, violations }));
} catch (e) {
  // Mask even failure captures. Never dump browser DOM, request headers or input.
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true, mask: [page.locator('input[type="password"]')] }).catch(() => {});
  await writeFile(`reports/byok-${live ? "live" : "replay"}-failure.json`, JSON.stringify({ analyses, checks, usage, before, errors, violations }));
  throw new Error(String(e.message).split(key).join("[REDACTED]"));
} finally { await browser.close(); }
