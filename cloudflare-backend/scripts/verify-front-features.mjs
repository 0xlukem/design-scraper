// Built UI, simulated API only. Gallery assets are reviewed local responses.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';
const site = process.env.PAGES_URL;
assert.ok(site && ['localhost', '127.0.0.1'].includes(new URL(site).hostname), 'Local UI only');
const api = process.env.API_URL || 'https://design-scraper-phase8.lucas-malizia27.workers.dev';
const artifacts = '../output/playwright/front-features';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
const unexpected = await isolateReplayNetwork(context, site);
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let analyses = 0, quotaRequests = 0, responseMode = 'success', finishSlow;
const quota = { day: '2026-10-10', resets_at: '2026-10-11T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true };
const catalog = JSON.parse(await readFile('../frontend/src/examples/catalog.json', 'utf8'));
const sample = JSON.parse(await readFile('../frontend/src/examples/milligram.json', 'utf8'));
await context.route("**/api/**", async route => {
  const headers = { 'access-control-allow-origin': site, 'access-control-expose-headers': 'Retry-After', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (route.request().url().endsWith('/providers')) return route.fulfill({ headers, json: { providers: ['gemini', 'anthropic', 'openai', 'xai'].map(provider => ({ provider, model: `${provider}-test`, inputPrice: provider === 'gemini' ? 0.75 : null, outputPrice: provider === 'gemini' ? 4.5 : null })) } });
  if (route.request().url().endsWith('/quotas')) { quotaRequests++; return route.fulfill({ headers, json: quota }); }
  analyses++;
  if (responseMode === 'slow') { await new Promise(resolve => { finishSlow = resolve; }); return route.fulfill({ headers, json: sample }).catch(() => {}); }
  if (responseMode === 'error') return route.fulfill({ status: 504, headers: { ...headers, 'Retry-After': '2' }, json: { detail: { code: 'SCRAPE_TIMEOUT', message: 'The source website took too long to load.', retryable: true } } });
  return route.fulfill({ headers, json: sample });
});
const checks = [];
async function overflow(label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label);
}
try {
  await page.goto(site);
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  await page.getByRole('tab', { name: 'Models & rates', exact: true }).click();
  await page.getByRole('cell', { name: 'gemini-test', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Models & estimated rates' }).getByText('Unavailable', { exact: true }).count(), 6);
  assert.equal(await page.getByLabel('Provider API key').count(), 0);
  checks.push('Rates are available without a key and preserve unavailable pricing');
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  const quotaBeforeLibrary = quotaRequests;
  await page.getByRole('link', { name: 'Design library', exact: true }).click();
  await page.reload();
  await page.getByRole('heading', { name: 'Design library', exact: true }).waitFor();
  assert.match(page.url(), /#\/library$/);
  await page.goBack();
  await page.getByLabel('Website URL', { exact: true }).waitFor();
  await page.goForward();
  await page.getByRole('heading', { name: 'Design library', exact: true }).waitFor();
  checks.push('Deep link, reload, back and forward preserve section');
  assert.equal(await page.getByRole('article').count(), catalog.length, 'Every catalog entry renders a card');
  assert.ok(catalog.length >= 4 && new Set(catalog.map(entry => entry.id)).size === catalog.length);
  const columns = await page.locator('.library-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  assert.equal(columns, 4, 'Desktop library shows four designs per row');
  checks.push(`Catalog renders ${catalog.length} cards in a four-column grid`);
  for (const { name, id, mode } of catalog) {
    const mixed = mode === 'mix';
    const expected = JSON.parse(await readFile(`../frontend/src/examples/${id}.json`, 'utf8'));
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    const cover = card.locator('.library-cover img');
    await cover.scrollIntoViewIfNeeded();
    assert.equal(new URL(await cover.getAttribute('src'), site).origin, new URL(site).origin, 'Cover artwork is served locally');
    assert.ok(await cover.evaluate(async image => { await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0; }), `${id}: brand cover loads and decodes`);
    assert.equal(await card.getByRole('combobox').count(), 0, 'Cards no longer carry a format selector');
    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: `Download ${name} design.md`, exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'design.md');
    assert.equal(await readFile(await download.path(), 'utf8'), expected.documents.extended);
    assert.equal(await page.locator('#saved-design-preview').count(), 0);
    checks.push(`${id}: direct design.md download without opening report`);
    await page.getByRole('button', { name: `View ${name} design`, exact: true }).click();
    const preview = page.locator('#saved-design-preview');
    await preview.getByRole('heading', { name: 'Design findings' }).waitFor();
    await preview.getByRole('button', { name: 'Export design', exact: true }).click();
    for (const [tab, variant, bytes, filename] of [
      ['DESIGN.md', 'Extended', expected.documents.extended, mixed ? 'mixed-design.md' : 'design.md'],
      ['DESIGN.md', 'Compact', expected.documents.compact, mixed ? 'mixed-design-compact.md' : 'design-compact.md'],
      ['CSS Variables', null, expected.exports.css_variables, 'design-variables.css'],
      ['Tailwind v4', null, expected.exports.tailwind, 'tailwind-theme.css'],
      ['Design Tokens', null, expected.exports.design_tokens, 'tokens.json'],
    ]) {
      await preview.getByRole('tab', { name: tab, exact: true }).click();
        if (variant) await preview.getByRole('button', { name: variant, exact: true }).click();
      await preview.getByRole('button', { name: 'Copy', exact: true }).click();
      await preview.getByRole('button', { name: 'Copied', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), bytes);
      const downloadPromise = page.waitForEvent('download');
      await preview.getByRole('button', { name: /^Download/ }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), filename);
      assert.equal(await readFile(await download.path(), 'utf8'), bytes);
      checks.push(`${id}: ${variant || tab} clipboard/download matches`);
    }
    await preview.getByRole('button', { name: 'Close export', exact: true }).click();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await overflow(`${id}-${width}`);
      if (id === 'milligram') await page.locator('#design-library').screenshot({ path: `${artifacts}/gallery-${width}.png` });
    }
    await page.getByRole('button', { name: 'Close design' }).click();
  }
  assert.equal(analyses, 0);
  assert.equal(quotaRequests, quotaBeforeLibrary, 'Browsing the library never checks the shared allowance');
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  await page.getByText('No analyses yet.', { exact: false }).waitFor();
  checks.push('Gallery: zero analysis requests and no session consumption');
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await page.getByLabel('Website URL', { exact: true }).waitFor();
  const quotaBeforeIntent = quotaRequests;
  const chips = page.getByRole('group', { name: 'Try a reference', exact: true });
  const firstSingle = catalog.find(entry => entry.mode === 'single');
  await chips.getByRole('button', { name: new URL(firstSingle.sources[0]).hostname.replace(/^www\./, ''), exact: true }).click();
  assert.equal(await page.getByLabel('Website URL', { exact: true }).inputValue(), firstSingle.sources[0]);
  assert.equal(await page.getByLabel('Website URL', { exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByText('17 of 20 shared analyses left today', { exact: false }).waitFor();
  assert.equal(quotaRequests, quotaBeforeIntent + 1, 'Showing intent checks the allowance exactly once');
  assert.equal(analyses, 0, 'Suggestions never submit an analysis');
  checks.push('Suggestion chips prefill the form, focus it and reveal the remaining shared allowance without submitting');
  await page.getByRole('link', { name: 'Design library', exact: true }).click();
  await page.locator('#design-library').screenshot({ path: `${artifacts}/library-mobile.png` });
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Website URL', { exact: true }).fill('https://example.com/');
  responseMode = 'slow';
  await page.getByRole('button', { name: /analyze design/i }).click();
  await page.getByRole('progressbar').waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('value'), null);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await overflow(`loading-${width}`);
    if (width === 320) await page.locator('section[aria-busy="true"]').screenshot({ path: `${artifacts}/loading-mobile.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('section[aria-busy="true"]').screenshot({ path: `${artifacts}/loading.png` });
  await page.getByRole('tab', { name: /Mix It/ }).click();
  assert.ok(await page.getByRole('button', { name: /mix designs/i }).isDisabled());
  await page.getByRole('tab', { name: /Extract design/ }).click();
  await page.getByRole('button', { name: 'Stop waiting' }).click();
  await page.getByText(/You stopped waiting/).waitFor();
  finishSlow?.();
  checks.push('Indeterminate loading, cross-mode duplicate guard, cancellation');
  responseMode = 'error';
  await page.getByRole('button', { name: /analyze design/i }).click();
  await page.getByText('Error details', { exact: true }).click();
  await page.getByText('Issue: SCRAPE_TIMEOUT', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: /Retry in/ }).isDisabled());
  await page.getByRole('alert').screenshot({ path: `${artifacts}/error.png` });
  await page.setViewportSize({ width: 320, height: 1000 });
  await overflow('error-mobile');
  await page.getByRole('alert').screenshot({ path: `${artifacts}/error-mobile.png` });
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(analyses, 2, 'No automatic retries');
  responseMode = 'success';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('heading', { name: 'Design findings' }).waitFor();
  await page.getByRole('link', { name: 'Activity & costs', exact: true }).click();
  const spending = page.getByRole('region', { name: 'Session activity', exact: true });
  await spending.getByText('Estimated subtotals', { exact: true }).click();
  await spending.getByText('Design Scraper / gemini · 3 requests', { exact: true }).waitFor();
  assert.ok(await spending.getByText('2 with unknown or incomplete cost · partial subtotal', { exact: true }).count());
  checks.push('Retry-After, unknown failed/cancelled costs, success counted once');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await overflow(`spending-${width}`);
    await spending.screenshot({ path: `${artifacts}/spending-${width}.png` });
  }
  for (const section of ['Analyze', 'Design library', 'Activity & costs']) {
    await page.getByRole('link', { name: section, exact: true }).click();
    assert.doesNotMatch(await page.locator('body').innerText(), /\bdemo\b/i);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await overflow(`${section}-${width}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${artifacts}/workspace-${section.split(' ')[0].toLowerCase()}-${width}.png` });
    }
  }
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await writeFile('reports/front-features-replay.json', JSON.stringify({ analyses, checks, errors, unexpectedNetwork: unexpected }, null, 2));
  console.log(JSON.stringify({ mode: 'front-features-replay', analyses, checks: checks.length, errors }));
} finally { finishSlow?.(); await browser.close(); }
