// Built UI over temporary HTTPS; all API and provider behavior is simulated.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';
const site = process.env.PAGES_URL;
assert.ok(site && new URL(site).hostname === '127.0.0.1' && new URL(site).protocol === 'https:', 'Local HTTPS only');
const api = process.env.API_URL || 'https://design-scraper-phase8.lucas-malizia27.workers.dev';
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const unexpected = await isolateReplayNetwork(context, site);
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const requests = [];
const reports = '../output/playwright/telemetry'; await mkdir(reports, { recursive: true });
const usage = JSON.parse(await readFile('../frontend/src/examples/milligram.json', 'utf8')).metadata.usage;
const telemetry = { funding: 'demo', provider: 'gemini', model: 'fixture-model', provider_calls: 2, generation_attempts: 1, auxiliary_calls: 1, final: false, usage_status: 'pending', usage: null, demo_budget: null, browser_ms: null, browser_reserved_ms: 75000 };
const budget = { day: '2026-09-18', admitted: 2, dailyLimit: 20, ipHourlyLimit: 3, ipDailyLimit: 5, browserMsUsedOrReserved: 150000, browserMsLimit: 480000, tokensUsedOrReserved: 92000, dailyTokenLimit: 1000000, active: 0, costStatus: 'estimated', dailyMicroUsdUsedOrReserved: 185000, totalMicroUsdUsedOrReserved: 1185000, dailyMicroUsdLimit: 1000000, totalMicroUsdLimit: 30000000, activeReservations: { tokens: 92000, microUsd: 105000, browserMs: 75000 }, demoCalls: { since: '2026-09-18T00:00:00Z', daily: { generation: 4, auxiliary: 3 }, total: { generation: 5, auxiliary: 4 } } };
await context.route("**/api/**", async route => {
  const r = route.request();
  const headers = { 'access-control-allow-origin': site, 'access-control-allow-headers': 'Content-Type, Authorization, X-AI-Provider, X-AI-Key', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  requests.push({ path: new URL(r.url()).pathname, authenticated: Boolean(r.headers().authorization) });
  if (r.url().endsWith('/quotas')) return route.fulfill({ headers, json: { day: '2026-09-18', resets_at: '2026-09-19T00:00:00Z', analyses: { used: 2, limit: 20, remaining: 18 }, capture: { remaining_ms: 330000, limit_ms: 480000, used_or_reserved_ms: 150000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true } });
  if (r.url().endsWith('/diagnostics/budget')) {
    const authorized = r.headers().authorization === 'Bearer fake-owner-token';
    return route.fulfill({ status: authorized ? 200 : 401, headers, json: authorized ? budget : { detail: { code: 'UNAUTHORIZED' } } });
  }
  if (r.url().endsWith('/analyze')) {
    assert.equal(r.headers().accept, 'application/x-ndjson');
    const sample = JSON.parse(await readFile('../frontend/src/examples/milligram.json', 'utf8'));
    const events = [
      { type: 'progress', progress: { stage: 'analyzing', source: null, completed_steps: 2, total_steps: 4, percent: 50, telemetry } },
      { type: 'result', payload: { ...sample, telemetry: { ...telemetry, final: true, usage_status: 'reported', usage, browser_ms: 1234, browser_reserved_ms: 0, demo_budget: { tokens_charged_or_reserved: usage.total_tokens, micro_usd_charged_or_reserved: 19141, conservative: false } } } },
    ];
    return route.fulfill({ headers: { ...headers, 'content-type': 'application/x-ndjson' }, body: events.map(e => JSON.stringify(e) + '\n').join('') });
  }
  return route.fulfill({ status: 404, headers, json: {} });
});
const checks = [];
try {
  await page.goto(site);
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  await page.getByText('Service limits', { exact: true }).click();
  await page.getByText('18', { exact: true }).waitFor();
  assert.ok(requests.every(r => !r.authenticated));
  assert.equal(await page.getByLabel('Administrative token').count(), 0);
  checks.push('Public quota without credential, analysis, or protected budget controls');
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await page.getByLabel('Website URL', { exact: true }).fill('https://example.com');
  await page.getByRole('button', { name: /Analyze design/ }).click();
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  const spending = page.getByRole('region', { name: 'Session activity', exact: true });
  await spending.locator('summary').filter({ hasText: 'Run details' }).click();
  await spending.getByLabel('Analysis telemetry').waitFor();
  assert.match(await spending.getByLabel('Analysis telemetry').innerText(), /Provider calls: 2.*Generation attempts: 1.*Auxiliary calls: 1/);
  checks.push('NDJSON result and measured provider/generation/auxiliary calls in activity details');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole('region', { name: 'Service availability', exact: true }).screenshot({ path: `${reports}/budget-${width}.png` });
    checks.push(`Site availability at ${width}px, no page overflow`);
  }
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.ok(requests.every(r => r.path !== '/api/diagnostics/budget' && !r.authenticated));
  checks.push('No administrative requests or browser persistence');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  await writeFile('reports/telemetry-replay.json', JSON.stringify({ checks, errors, unexpectedNetwork: unexpected, requests }, null, 2));
  console.log(JSON.stringify({ mode: 'telemetry-replay', checks: checks.length, errors }));
} finally { await browser.close(); }
