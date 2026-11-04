// Exercise the public npm demo command and its real local middleware. API calls
// are not mocked by this test; every non-loopback browser request is blocked.
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import validate from '../src/domain/validate.js';
import { isolateReplayNetwork } from './replay-network.mjs';
import { readAnalysisResponse } from './read-analysis-response.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const child = spawn('npm', ['run', 'demo', '--', '--port', '0', '--strictPort'], {
  cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_API_URL: 'https://must-not-contact.invalid', NO_COLOR: '1', CI: 'true' },
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
let browser;
const checks = [], errors = [], requests = [];
try {
  const site = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Demo startup timed out: ${output}`)), 20000);
    const ready = () => {
      const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
      if (url) { clearTimeout(timer); child.stdout.off('data', ready); resolve(url); }
    };
    child.stdout.on('data', ready);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Demo exited (${code}): ${output}`)); });
    ready();
  });
  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
  const unexpected = await isolateReplayNetwork(context, site);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      assert.equal(new URL(request.url()).origin, site);
      assert.ok(!request.headers().authorization && !request.headers()['x-ai-key']);
      requests.push({ path: new URL(request.url()).pathname, method: request.method() });
    }
  });
  const single = JSON.parse(await readFile('../frontend/src/examples/example-domain.json', 'utf8'));
  const fixtures = JSON.parse(await readFile('tests/fixtures/contracts.json', 'utf8'));
  const direct = async (mix = false, scenario = 'success') => {
    const body = mix ? {
      url_1: await page.getByLabel('First website URL').inputValue(),
      url_2: await page.getByLabel('Second website URL').inputValue(),
      bias: Number(await page.getByLabel('Mix balance').inputValue()),
    } : { url: await page.getByLabel('Website URL', { exact: true }).inputValue() };
    return readAnalysisResponse(await fetch(`${site}/api/${mix ? 'mix' : 'analyze'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Demo-Scenario': scenario }, body: JSON.stringify(body),
    }));
  };
  const submit = async (mix = false, button = null) => {
    const response = page.waitForResponse(response => response.url() === `${site}/api/${mix ? 'mix' : 'analyze'}` && response.request().method() === 'POST');
    await (button || page.getByRole('button', { name: mix ? 'Mix designs' : 'Analyze design', exact: true })).click();
    const value = await response;
    assert.equal(value.headers()['x-local-demo'], 'true');
    return value;
  };
  const successful = async (mix = false) => {
    const response = await submit(mix);
    await page.getByRole('progressbar').waitFor();
    assert.ok(Number(await page.getByRole('progressbar').getAttribute('value')) < 100);
    assert.equal(response.status(), 200);
    // The UI cancels its Fetch reader as soon as it receives a terminal event.
    // Chromium can therefore discard its buffered response body. Validate the
    // real middleware independently and verify the UI through rendered exports.
    const { type, payload } = await direct(mix);
    assert.equal(type, 'result');
    assert.ok(validate(payload.design_system), JSON.stringify(validate.errors));
    assert.equal(payload.telemetry.usage_status, 'not_called');
    assert.equal(payload.telemetry.provider_calls, 0);
    assert.equal(payload.metadata.usage.estimated_cost_usd, 0);
    await page.getByRole('heading', { name: 'Design findings', exact: true }).waitFor();
    return payload;
  };
  const exports = async payload => {
    const calls = requests.filter(request => request.method === 'POST').length;
    for (const [tab, variant, bytes] of [
      ['DESIGN.md', 'Extended', payload.documents.extended], ['DESIGN.md', 'Compact', payload.documents.compact],
      ['CSS Variables', null, payload.exports.css_variables], ['Tailwind v4', null, payload.exports.tailwind], ['Design Tokens', null, payload.exports.design_tokens],
    ]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (variant) await page.getByRole('button', { name: variant, exact: true }).click();
      await page.getByRole('button', { name: 'View code', exact: true }).click();
      await page.getByRole('button', { name: 'Copy', exact: true }).click();
      await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), bytes);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: /^Download / }).click();
      assert.equal(await readFile(await (await download).path(), 'utf8'), bytes);
    }
    assert.equal(requests.filter(request => request.method === 'POST').length, calls);
  };

  await page.goto(site);
  await page.getByRole('link', { name: 'Analyze a website', exact: true }).click();
  await page.waitForURL(`${site}/app/#/analyze/start`);
  await page.getByRole('complementary', { name: 'Local demo' }).waitFor();
  assert.equal(requests.filter(request => request.method === 'POST').length, 0, 'Entering the demo never submits an analysis');
  checks.push('Public home opens the simulated workspace without submitting');
  assert.equal(await page.getByRole('button', { name: 'Use your own key', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Provider API key').count(), 0);
  await page.getByLabel('Website URL', { exact: true }).fill('https://never-visit.invalid');
  const individual = await successful();
  assert.deepEqual(individual.documents, single.documents);
  assert.deepEqual(individual.exports, single.exports);
  assert.equal(individual.metadata.url, single.metadata.url, 'The sample must retain its original evidence URL');
  await exports(individual);
  checks.push('Single analysis, streamed progress, canonical validation, five exact clipboard/download exports, zero usage');

  await page.getByRole('tab', { name: /Mix It/ }).click();
  await page.getByLabel('First website URL').fill('https://first-never-visit.invalid');
  await page.getByLabel('Second website URL').fill('https://second-never-visit.invalid');
  for (const bias of [-50, -25, 0, 25, 50]) {
    await page.getByLabel('Mix balance').fill(String(bias));
    const mixed = await successful(true);
    const fixture = fixtures.find(item => item.bias === bias);
    assert.deepEqual(mixed.design_system, fixture.normalized);
    assert.deepEqual(mixed.documents, fixture.documents);
    assert.deepEqual(mixed.exports, fixture.exports);
    assert.deepEqual(mixed.metadata.weights, Object.fromEntries(fixture.sources.map(source => [source.label, source.weight])));
    if (bias === 0) await exports(mixed);
  }
  checks.push('Mix It at all five balances, including excluded sources, with consistent exports');

  await page.getByRole('tab', { name: /Extract design/ }).click();
  for (const [scenario, code] of [['capture-error', 'SCRAPE_TIMEOUT'], ['provider-error', 'PROVIDER_UNAVAILABLE'], ['rate-limit', 'RATE_LIMITED']]) {
    await page.getByLabel('Next demo run').selectOption(scenario);
    const response = await submit();
    assert.equal(response.status(), scenario === 'rate-limit' ? 429 : 200);
    const terminal = await direct(false, scenario);
    assert.equal(terminal.type, 'error');
    assert.equal(terminal.payload.detail.code, code);
    await page.getByRole('alert').waitFor();
    await page.getByText('Error details', { exact: true }).click();
    await page.getByText(`Issue: ${code}`, { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: /Retry in/ }).isDisabled());
    const beforeRetry = requests.filter(request => request.method === 'POST').length;
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await retry.waitFor();
    assert.equal(requests.filter(request => request.method === 'POST').length, beforeRetry, 'No automatic retries');
    assert.equal(await page.getByLabel('Next demo run').inputValue(), 'success');
    assert.equal((await submit(false, retry)).status(), 200);
    await page.getByRole('heading', { name: 'Design findings', exact: true }).waitFor();
  }
  checks.push('Capture/provider/quota failures, Retry-After deadlines and successful explicit retry');

  await page.getByLabel('Next demo run').selectOption('slow');
  await submit();
  await page.getByRole('progressbar').waitFor();
  await page.getByRole('tab', { name: /Mix It/ }).click();
  assert.ok(await page.getByRole('button', { name: 'Mix designs', exact: true }).isDisabled());
  await page.getByRole('tab', { name: /Extract design/ }).click();
  await page.getByRole('button', { name: 'Stop waiting', exact: true }).click();
  await page.getByText('Simulation stopped. No website or AI provider was called.', { exact: true }).waitFor();
  await page.getByText('No analysis yet', { exact: true }).waitFor();
  assert.equal(await page.locator('.result-shell:visible').count(), 0);
  checks.push('Cancellation discards the result and guards duplicate cross-mode submissions');

  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  const spending = page.getByRole('region', { name: 'Session activity', exact: true });
  await spending.getByText('Local simulation · US$0', { exact: true }).waitFor();
  const costs = await spending.locator('.run-details div').filter({ has: page.getByText('Estimated AI cost', { exact: true }) }).locator('dd').allTextContents();
  assert.ok(costs.length > 0);
  assert.ok(costs.every(cost => cost.startsWith('US$0.00000')));
  await page.getByRole('region', { name: 'Service availability', exact: true }).getByRole('button', { name: 'Check availability', exact: true }).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}px`);
  }
  await page.getByLabel('Next demo run').selectOption('rate-limit');
  await page.getByRole('button', { name: 'Check availability', exact: true }).click();
  await page.getByText('Daily limit reached', { exact: true }).waitFor();
  checks.push('Session activity, zero costs, refreshable simulated capacity and responsive demo controls');
  const calls = requests.filter(request => request.method === 'POST').length;
  await page.getByRole('link', { name: 'Design library', exact: true }).click();
  await page.getByRole('button', { name: 'View Stripe design', exact: true }).click();
  await page.getByRole('heading', { name: 'Design findings', exact: true }).waitFor();
  assert.equal(requests.filter(request => request.method === 'POST').length, calls);
  await page.reload();
  assert.equal(await page.getByLabel('Next demo run').inputValue(), 'success');
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  await page.getByText('No analyses in this session.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  checks.push('Library is independent; reload clears scenarios/activity; browser storage remains empty');

  const rejected = await fetch(`${site}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Key': 'fake-key-do-not-store' }, body: JSON.stringify({ url: 'https://never-visit.invalid' }) });
  assert.equal(rejected.status, 400);
  assert.ok(!(await rejected.text()).includes('fake-key-do-not-store'));
  assert.equal((await fetch(`${site}/api/unknown`)).status, 404);
  const assets = new URL('../../frontend/dist/assets/', import.meta.url);
  for (const file of await readdir(assets)) if (file.endsWith('.js')) {
    assert.doesNotMatch(await readFile(new URL(file, assets), 'utf8'), /Next demo run|X-Demo-Scenario|fixture-replay|Local demo · simulated/, 'Demo controls and transport must not ship in Pages');
  }
  const { resolveConfig } = await import('../../frontend/node_modules/vite/dist/node/index.js');
  const live = await resolveConfig({ root: fileURLToPath(new URL('../../frontend/', import.meta.url)), mode: 'live' }, 'serve');
  assert.ok(!live.plugins.some(plugin => plugin.name === 'local-demo-api'));
  assert.equal(live.server.proxy['/api'].target, 'http://127.0.0.1:8787');
  assert.deepEqual(Object.keys(live.server.proxy), ['/api'], 'Every live API route uses the local Worker');
  checks.push('Credentials/unknown endpoints rejected; demo code absent from Pages build; external API override ignored');
  checks.push('Live mode excludes the simulation and retains the local Worker proxy');
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await mkdir('reports', { recursive: true });
  await writeFile('reports/demo-local.json', JSON.stringify({ checks, errors, unexpectedNetwork: unexpected, requests }, null, 2));
  console.log(JSON.stringify({ mode: 'local-demo', checks, errors, unexpectedNetwork: unexpected }));
} finally {
  await browser?.close();
  if (child.pid) {
    try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
}
