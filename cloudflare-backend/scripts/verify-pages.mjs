// Real Chromium verification. Default: committed contract fixtures, no keys/AI.
// --live sends exactly one individual analysis and one mix to the public API.
// --live --mix-only verifies only the remaining mix without repeating paid work.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { isolateReplayNetwork } from "./replay-network.mjs";
import { readAnalysisResponse } from "./read-analysis-response.mjs";
const site = process.env.PAGES_URL || "https://design-scraper.pages.dev";
const api = process.env.API_URL || "https://design-scraper-phase8.lucas-malizia27.workers.dev";
const live = process.argv.includes("--live");
const kinds = process.argv.includes("--mix-only") ? ["mix"] : ["single", "mix"];
assert.ok(live || kinds.length === 2, "--mix-only requires --live");
const vars = live ? await readFile(".dev.vars", "utf8") : "";
// The retained admin token is used only by Node for the budget query.
const token = live ? vars.split(/\r?\n/).find(s => s.startsWith("PHASE8_AUTH_TOKEN="))?.slice(18).trim() : null;
if (live) assert.ok(token, "An administrative token is required to check the live QA budget.");
const artifacts = "../output/playwright/verification";
await mkdir(artifacts, { recursive: true });
await mkdir("reports", { recursive: true });
const budget = async () => {
  const r = await fetch(`${api}/api/diagnostics/budget`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  return r.json();
};
const before = live ? await budget() : null;
if (live) {
  const reserve = 210000 * kinds.length;
  assert.ok(before.totalMicroUsdLimit - before.totalMicroUsdUsedOrReserved >= reserve, "Insufficient project budget for bounded tests");
  assert.ok(before.dailyMicroUsdLimit - before.dailyMicroUsdUsedOrReserved >= reserve, "Insufficient daily QA budget");
  assert.ok(before.browserMsLimit - before.browserMsUsedOrReserved >= (kinds.length === 1 ? 80000 : 120000), "Insufficient capture allowance for bounded tests");
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"], serviceWorkers: "block" });
const unexpectedNetwork = live ? [] : await isolateReplayNetwork(context, site);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });
let analyses = 0;
const credentialRequests = [];
page.on("request", r => {
  if (r.url().startsWith(`${api}/api/`) && (r.headers().authorization || r.url().endsWith("/session"))) credentialRequests.push(r.url());
});
page.on("request", r => { if (/\/api\/(analyze|mix)$/.test(r.url()) && r.method() === "POST") analyses++; });
let injectedError = null;
if (!live) {
  const fixtures = JSON.parse(await readFile("tests/fixtures/contracts.json", "utf8"));
  const payload = f => ({
    success: true, design_md: f.documents.extended,
    design_system: f.normalized, documents: f.documents, exports: f.exports,
    metadata: f.bias === null
      ? { url: f.sources[0].url, title: "Contract fixture", description: "", colors_extracted: 1, fonts_extracted: 1 }
      : { mode: "mix", bias: f.bias, weights: Object.fromEntries(f.sources.map(s => [s.label, s.weight])),
          sources: f.sources.map(s => ({ slot: s.label, url: s.url, influence: s.weight, status: s.weight ? "analyzed" : "excluded", title: "Contract fixture", description: "", colors_extracted: 1, fonts_extracted: 1 })) },
  });
  const single = payload(fixtures.find(f => f.bias === null));
  const mix = payload(fixtures.find(f => f.bias === 25));
  await page.route(`${api}/api/**`, async route => {
    const req = route.request();
    const headers = { "access-control-allow-origin": site, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (req.url().endsWith("/quotas")) return route.fulfill({ headers, json: { day: '2026-10-10', resets_at: '2026-10-11T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true } });
    if (injectedError) return route.fulfill({ status: injectedError.status, headers, json: { detail: injectedError } });
    return route.fulfill({ headers, json: req.url().endsWith("/mix") ? mix : single });
  });
}
const results = [];
async function assertNoOverflow(name) {
  // Viewport metrics can update before CSS media queries and layout paint.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sizes = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth }));
  if (sizes.actual > sizes.width + 1) {
    const outside = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({ tag: e.tagName, class: String(e.className), right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width })));
    console.log(JSON.stringify({ name, sizes, outside }));
  }
  assert.ok(sizes.actual <= sizes.width + 1, `${name}: ${JSON.stringify(sizes)}`);
}
async function outputs(payload, kind) {
  for (const [tab, variant, expected, filename] of [
    ["DESIGN.md", "Extended", payload.documents.extended, kind === "mix" ? "mixed-design.md" : "design.md"],
    ["DESIGN.md", "Compact", payload.documents.compact, kind === "mix" ? "mixed-design-compact.md" : "design-compact.md"],
    ["Tailwind v4", null, payload.exports.tailwind, "tailwind-theme.css"],
    ["CSS Variables", null, payload.exports.css_variables, "design-variables.css"],
    ["Design Tokens", null, payload.exports.design_tokens, "tokens.json"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (variant) await page.getByRole("button", { name: variant, exact: true }).click();
    await page.getByRole("button", { name: "View code", exact: true }).click();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download / }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), filename);
    assert.equal(await readFile(await download.path(), "utf8"), expected);
    results.push(`${kind}: ${variant || tab}, clipboard and download bytes match`);
    await assertNoOverflow(`${kind}-${tab}`);
  }
}
try {
  const root = await page.goto(site);
  assert.equal(root.status(), 200);
  assert.match(root.headers()["x-robots-tag"] || "", /noindex/);
  assert.match(root.headers()["content-security-policy"] || "", /frame-ancestors 'none'/);
  await page.getByLabel("Website URL").waitFor();
  assert.equal(await page.getByLabel("Preview access code").count(), 0);
  results.push("Direct access: analysis form is available without a code");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main-content').evaluate(element => element === document.activeElement), true);
  results.push('Keyboard skip link focuses the main workspace');
  for (const kind of kinds) {
    if (kind === "single") {
      await page.getByLabel("Website URL").fill("https://milligram.io/");
    } else {
      await page.getByRole("tab", { name: /Mix It/ }).click();
      await page.getByLabel("First website URL").fill(process.env.MIX_SOURCE_ONE || "https://getbootstrap.com/docs/5.3/examples/heroes/");
      await page.getByLabel("Second website URL").fill(process.env.MIX_SOURCE_TWO || "https://milligram.io/");
      await page.getByLabel("Mix balance").fill("25");
    }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(`${kind}-home-${width}`);
      assert.equal(await page.getByRole('button', { name: 'Pause animations', exact: true }).isVisible(), true, `Motion control keeps an accessible name at ${width}px`);
      if (width <= 640) {
        const previousUrl = page.url(), previousCalls = analyses;
        await page.getByRole('link', { name: 'Go to the lab', exact: true }).click();
        assert.equal(await page.locator(kind === 'single' ? '#single-url' : '#mix-url-1').evaluate(element => element === document.activeElement), true);
        assert.equal(page.url(), previousUrl, 'Jumping to the form must not mutate the route');
        assert.equal(analyses, previousCalls, 'Jumping to the form must not start an analysis');
        results.push(`${kind}: mobile lab shortcut focuses the form without navigation or analysis at ${width}px`);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${artifacts}/${kind === "single" ? "design-scraper" : "mix-it"}-home-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const responsePromise = page.waitForResponse(r => r.url() === `${api}/api/${kind === "mix" ? "mix" : "analyze"}` && r.request().method() === "POST", { timeout: 195000 });
    await page.getByRole("button", { name: kind === "mix" ? /mix designs/i : /analyze design/i }).click();
    const response = await responsePromise;
    const { type, payload } = await readAnalysisResponse(response);
    assert.equal(response.status(), 200, `${kind}: ${payload?.detail?.code || response.status()}`);
    assert.equal(type, 'result', `${kind}: ${payload?.detail?.code || 'ANALYSIS_FAILED'}`);
    assert.equal(payload?.success, true);
    if (kind === "mix") assert.deepEqual(payload.metadata.weights, { web_1: 25, web_2: 75 });
    if (live) {
      await writeFile(`reports/result-live-${kind}.json`, JSON.stringify(payload, null, 2));
      console.log(JSON.stringify({ kind, status: response.status(), analysisId: response.headers()["x-analysis-id"], usage: payload.metadata.usage }));
    }
    await page.getByRole("heading", { name: "Design findings" }).waitFor();
    await page.locator('.result-shell:visible').screenshot({ path: `${artifacts}/${kind === "single" ? "design-scraper" : "mix-it"}-result.png` });
    const calls = analyses;
    await outputs(payload, kind);
    const tab = page.getByRole("tab", { name: "DESIGN.md", exact: true });
    await tab.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("tab", { name: "Tailwind v4" }).getAttribute("aria-selected"), "true");
    assert.ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"));
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await assertNoOverflow(`${kind}-${width}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${artifacts}/${live ? "live" : "replay"}-${kind}-${width}.png`, fullPage: true });
    }
    assert.equal(analyses, calls, "Output actions must not generate another AI request");
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  if (!live) {
    await page.getByRole("tab", { name: /Extract design/ }).click();
    for (const code of ["RATE_LIMITED", "IP_DAILY_LIMIT_REACHED", "DAILY_LIMIT_REACHED", "DAILY_AI_BUDGET_EXHAUSTED", "PROJECT_BUDGET_EXHAUSTED", "BROWSER_QUOTA_EXHAUSTED", "UNSAFE_URL", "SCRAPE_TIMEOUT", "PROVIDER_QUOTA_EXHAUSTED"]) {
      injectedError = { code, message: `Test error: ${code}`, status: code.includes("TIMEOUT") ? 504 : 429 };
      await page.getByRole("button", { name: /analyze design/i }).click();
      await page.getByRole("alert").filter({ hasText: injectedError.message }).waitFor();
      results.push(`Error UI: ${code}`);
    }
  }
  await page.reload();
  await page.getByLabel("Website URL").waitFor();
  assert.equal(await page.getByLabel("Preview access code").count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(credentialRequests, []);
  results.push("Reload keeps direct access; no session or Authorization requests from the browser");
  if (!live && new URL(site).protocol === "http:") {
    await page.getByRole("button", { name: "Use your own key", exact: true }).click();
    await page.getByRole("radio", { name: "Your own key", exact: true }).check();
    await page.getByText(/Using your own key requires an HTTPS page and API/).waitFor();
    assert.equal(await page.getByLabel("Provider API key", { exact: true }).count(), 0);
    results.push("HTTP frontend refuses to collect a BYOK credential");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedNetwork, [], "Replay attempted an unmocked external connection");
  const after = live ? await budget() : null;
  if (live) {
    assert.equal(analyses, kinds.length);
    assert.ok(after.totalMicroUsdUsedOrReserved - before.totalMicroUsdUsedOrReserved <= 1000000, "QA must stay within its approved $1 estimate");
  }
  const report = { mode: live ? "live" : "replay", fixture: live ? null : "committed-contracts", site, analyses, checks: results, before, after, errors, unexpectedNetwork };
  await writeFile(`reports/pages-${live ? kinds.length === 1 ? "live-mix" : "live" : "replay"}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, analyses, checks: results.length, errors }));
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
  console.log(JSON.stringify({ errors, ui: (await page.locator('body').innerText()).slice(0, 3000) }));
  throw error;
} finally { await browser.close(); }
