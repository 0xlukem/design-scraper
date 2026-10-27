// Mix form behavior against the built UI; all analysis responses are intercepted.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';
const site = process.env.PAGES_URL;
assert.ok(site && ['localhost', '127.0.0.1'].includes(new URL(site).hostname));
const artifacts = '../output/playwright/mix-flow';
await mkdir(artifacts, { recursive: true });
const sample = JSON.parse(await readFile('../frontend/src/examples/milligram.json', 'utf8'));
const quota = { day: '2026-10-26', resets_at: '2026-10-27T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const unexpected = await isolateReplayNetwork(context, site);
const errors = [], requests = [], checks = [];
await context.route('**/api/**', async route => {
  const request = route.request();
  const headers = { 'access-control-allow-origin': site, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (request.url().endsWith('/quotas')) return route.fulfill({ headers, json: quota });
  if (request.method() === 'POST') { requests.push({ path: new URL(request.url()).pathname, payload: request.postDataJSON() }); return route.fulfill({ headers, json: sample }); }
  throw new Error('Unexpected API request');
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
async function openMix() {
  await page.goto(site);
  await page.getByRole('tab', { name: 'Mix It', exact: true }).click();
  await page.getByLabel('First website URL').waitFor();
}
try {
  for (const bias of [-50, 50]) {
    await openMix();
    const active = page.getByLabel(bias === -50 ? 'First website URL' : 'Second website URL');
    const excluded = page.getByLabel(bias === -50 ? 'Second website URL' : 'First website URL');
    await active.fill('https://milligram.io/');
    await excluded.fill('invalid-unused-source');
    await page.getByLabel('Mix balance').fill(String(50 - bias));
    assert.equal(await excluded.isDisabled(), true);
    assert.equal(await excluded.getAttribute('required'), null);
    const before = requests.length;
    await page.getByRole('button', { name: 'Analyze selected source', exact: true }).click();
    await page.getByRole('button', { name: 'Export design', exact: true }).waitFor();
    assert.equal(requests.length, before + 1);
    assert.deepEqual(requests.at(-1), { path: '/api/analyze', payload: { url: 'https://milligram.io/' } });
    await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
    const row = page.locator('.session-run').filter({ hasText: '#1' });
    assert.match(await row.innerText(), /milligram.io/);
    assert.doesNotMatch(await row.innerText(), /invalid-unused-source/);
    checks.push(`${bias}: excluded invalid URL cannot block submission; only active URL is sent and recorded`);
  }
  await openMix();
  await page.getByLabel('Mix balance').fill('50');
  await page.getByRole('button', { name: 'Bootstrap × Milligram', exact: true }).click();
  assert.equal(await page.getByLabel('Mix balance').inputValue(), '25');
  await page.waitForFunction(() => document.activeElement?.id === 'mix-url-1');
  assert.equal(await page.getByLabel('First website URL').inputValue(), 'https://getbootstrap.com/docs/5.3/examples/heroes/');
  assert.equal(requests.length, 2);
  checks.push('Reference suggestion restores original 25/75 balance without submission');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const balance = page.getByLabel('Mix balance');
    assert.equal(await balance.inputValue(), '25');
    assert.equal(await balance.evaluate(el => getComputedStyle(el).getPropertyValue('--first-share').trim()), '25%');
    assert.match(await balance.getAttribute('aria-valuetext'), /getbootstrap.com 25 percent, milligram.io 75 percent/);
    assert.equal(await page.locator('#analysis-form input[type=range]').count(), 1);
    await page.locator('#analysis-form').screenshot({ path: `${artifacts}/mix-form-${width}.png` });
    checks.push(`${width}px: domain labels and true 25/75 proportions without overflow`);
  }
  await page.getByLabel('First website URL').fill('https://a-very-long-reference-website-name.example.com/');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Long domains wrap at 320px');
  await page.getByLabel('First website URL').fill('https://getbootstrap.com/docs/5.3/examples/heroes/');
  const slider = page.getByLabel('Mix balance');
  await slider.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await slider.inputValue(), '50');
  assert.match(await slider.getAttribute('aria-valuetext'), /getbootstrap.com 50 percent, milligram.io 50 percent/);
  checks.push('Keyboard changes and accessible domain/percentage labels agree');
  await page.getByLabel('First website URL').fill('https://example.com');
  await page.getByLabel('Second website URL').fill('https://example.com/');
  assert.equal(await page.getByRole('button', { name: 'Mix designs', exact: true }).isDisabled(), true);
  await page.getByRole('alert').filter({ hasText: 'two different URLs' }).waitFor();
  await slider.fill('100');
  assert.equal(await page.getByRole('button', { name: 'Analyze selected source', exact: true }).isEnabled(), true);
  await slider.fill('50');
  assert.equal(await page.getByLabel('Second website URL').inputValue(), 'https://example.com/');
  assert.equal(requests.length, 2);
  checks.push('Duplicate sources blocked locally; excluded input preserved when returning to a blend');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  await writeFile('reports/mix-flow-replay.json', JSON.stringify({ checks, requests, errors, unexpectedNetwork: unexpected }, null, 2));
  console.log(JSON.stringify({ mode: 'mix-flow-replay', analyses: requests.length, checks: checks.length, errors }));
} finally { await browser.close(); }
