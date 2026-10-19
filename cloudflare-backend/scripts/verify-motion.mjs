// Real GSAP playback, two visual worlds and paint navigation, with no analysis.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';

const site = process.env.PAGES_URL;
const api = process.env.API_URL || 'https://design-scraper-phase8.lucas-malizia27.workers.dev';
assert.ok(site && ['localhost', '127.0.0.1'].includes(new URL(site).hostname), 'Local UI only');
const artifacts = '../output/playwright/worlds';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const checks = [], errors = [], unexpectedNetwork = [], paintTransitions = [];
const scene = { single: '.studio-scene', mix: '.mix-world' };
const probe = { single: '.studio-scan', mix: '.mix-paint-sculpture' };
let analyses = 0;

async function open(reducedMotion, record = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, reducedMotion, serviceWorkers: 'block',
    ...(record ? { recordVideo: { dir: `${artifacts}/video`, size: { width: 1440, height: 1000 } } } : {}),
  });
  const unexpected = await isolateReplayNetwork(context, site);
  // Focusing a URL field reads the shared allowance; nothing else may leave the page.
  await context.route(`${api}/api/**`, async route => {
    const headers = { 'access-control-allow-origin': site, 'access-control-allow-methods': 'GET, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'GET' && route.request().url().endsWith('/quotas')) return route.fulfill({ headers, json: { day: '2026-10-10', resets_at: '2026-10-11T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true } });
    return route.fulfill({ status: 404, headers, json: { detail: { code: 'NOT_FOUND', message: 'Not found.', retryable: false } } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const artworkRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', event => console.error(`CSP violation: ${event.violatedDirective}`));
  });
  page.on('request', request => {
    if (/\/api\/(analyze|mix)$/.test(request.url())) analyses++;
    if (request.url().includes('/images/mix-it-paint-sculpture.webp')) artworkRequests.push('mix-artwork');
  });
  await page.goto(site);
  await page.getByLabel('Website URL', { exact: true }).waitFor();
  await page.locator(scene.single).waitFor();
  assert.equal(await page.locator(scene.mix).count(), 0, 'The base site must not mount the surreal Mix It world');
  assert.equal(artworkRequests.length, 0, 'The base site must not download the Mix It artwork');
  assert.equal(await page.locator('.world-transition').getAttribute('data-state'), 'idle', 'Initial rendering must not trigger paint navigation');
  assert.equal(await page.locator('.world-transition').getAttribute('aria-hidden'), 'true');
  if (reducedMotion !== 'reduce') await viewportOverlay(page);
  await page.evaluate(() => {
    window.__worldPhases = [];
    window.__worldPaintSamples = [];
    const overlay = document.querySelector('.world-transition');
    let frame = null;
    const samplePaint = () => {
      frame = null;
      if (overlay.dataset.state === 'idle') return;
      const colors = [...overlay.querySelectorAll('.world-transition-flood, .world-transition-ribbon, .world-transition-drop')].map(element => {
        const style = getComputedStyle(element);
        const value = element.matches('.world-transition-ribbon') ? style.color : style.backgroundColor;
        return (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      });
      window.__worldPaintSamples.push({
        mode: overlay.dataset.target, phase: overlay.dataset.state,
        maxChroma: Math.max(...colors.map(rgb => Math.max(...rgb) - Math.min(...rgb))),
      });
      frame = requestAnimationFrame(samplePaint);
    };
    new MutationObserver(() => {
      window.__worldPhases.push(overlay.dataset.state);
      if (frame === null) samplePaint();
    })
      .observe(overlay, { attributes: true, attributeFilter: ['data-state'] });
  });
  return { context, page, unexpected, artworkRequests };
}

async function viewportOverlay(page) {
  const metrics = await page.locator('.world-transition').evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { x: box.x, y: box.y, width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight, position: style.position, events: style.pointerEvents };
  });
  assert.equal(metrics.position, 'fixed');
  assert.equal(metrics.events, 'none');
  assert.ok(Math.abs(metrics.x) < 1 && Math.abs(metrics.y) < 1);
  assert.ok(Math.abs(metrics.width - metrics.viewportWidth) < 1 && Math.abs(metrics.height - metrics.viewportHeight) < 1, 'Paint overlay must cover the viewport, independent of page layout');
}

async function ready(page, mode) {
  await page.locator(`[data-experience="${mode}"]`).waitFor();
  await page.locator(scene[mode]).waitFor();
  assert.equal(await page.locator(scene[mode === 'single' ? 'mix' : 'single']).count(), 0);
  if (mode === 'mix') await page.waitForFunction(() => {
    const image = document.querySelector('.mix-paint-sculpture');
    return image?.complete && image.naturalWidth > 0;
  });
}

async function still(page, mode, label) {
  const samples = await page.locator(probe[mode]).evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = getComputedStyle(element).transform;
    await new Promise(resolve => setTimeout(resolve, 180));
    return [before, getComputedStyle(element).transform];
  });
  assert.equal(samples[0], samples[1], label);
}

async function moving(page, mode) {
  await page.locator(scene[mode]).scrollIntoViewIfNeeded();
  const before = await page.locator(probe[mode]).evaluate(element => getComputedStyle(element).transform);
  await page.waitForFunction(({ selector, before }) => getComputedStyle(document.querySelector(selector)).transform !== before, { selector: probe[mode], before });
}

async function switchWorld(page, mode) {
  await page.getByRole('banner').getByRole('button', { name: mode === 'mix' ? 'Enter Mix It' : 'Back to Design Scraper', exact: true }).click();
  await ready(page, mode);
}

async function settled(page) {
  await page.waitForFunction(() => document.querySelector('.world-transition').dataset.state === 'idle');
  assert.equal(await page.locator('.world-transition').evaluate(element => getComputedStyle(element).visibility), 'hidden');
}

async function captureTransition(page, mode, suffix) {
  await page.evaluate(() => { window.__worldPhases = []; window.__worldPaintSamples = []; scrollTo(0, 0); });
  const previous = mode === 'mix' ? 'single' : 'mix';
  await page.getByRole('banner').getByRole('button', { name: mode === 'mix' ? 'Enter Mix It' : 'Back to Design Scraper', exact: true }).click();
  await page.waitForFunction(() => {
    const root = document.querySelector('.world-transition');
    const flood = root.querySelector('.world-transition-flood');
    const transform = new DOMMatrix(getComputedStyle(flood).transform);
    return root.dataset.state === 'covering' && getComputedStyle(root).opacity === '1' && Math.hypot(transform.a, transform.b) >= .8;
  });
  await viewportOverlay(page);
  // The world only changes once the paint hides the swap, never while it is still arriving.
  const swap = await page.evaluate(({ previous }) => {
    const root = document.querySelector('.world-transition');
    const flood = root.querySelector('.world-transition-flood');
    const transform = new DOMMatrix(getComputedStyle(flood).transform);
    return { experience: document.querySelector('[data-experience]').dataset.experience, coverage: Math.hypot(transform.a, transform.b), state: root.dataset.state, previous };
  }, { previous });
  if (swap.experience !== previous) assert.ok(swap.coverage >= 1, `${mode}: the world must not change before the paint covers the viewport`);
  await ready(page, mode);
  await page.screenshot({ path: `${artifacts}/${mode === 'mix' ? 'enter-mix-it' : 'return-design-scraper'}-paint-${suffix}.png`, animations: 'allow' });
  if (mode === 'single') {
    await page.waitForFunction(() => {
      const samples = window.__worldPaintSamples;
      return samples.some(sample => sample.mode === 'single' && sample.maxChroma <= 1);
    });
    await page.screenshot({ path: `${artifacts}/return-design-scraper-monochrome-${suffix}.png`, animations: 'allow' });
  }
  await settled(page);
  const phases = await page.evaluate(() => window.__worldPhases);
  for (const phase of ['covering', 'revealing', 'idle']) assert.ok(phases.includes(phase), `${mode} paint transition must reach ${phase}`);
  assert.equal(await page.locator('.world-transition').getAttribute('data-target'), mode);
  const samples = await page.evaluate(mode => window.__worldPaintSamples.filter(sample => sample.mode === mode), mode);
  assert.ok(samples.length > 3, `${mode}: real paint frames were sampled`);
  if (mode === 'single') {
    assert.ok(samples[0].maxChroma > 100, 'The return starts with colored paint');
    assert.ok(samples.some(sample => sample.maxChroma > 5 && sample.maxChroma < 100), 'The return visibly desaturates instead of switching colors instantly');
    assert.ok(samples.some(sample => sample.phase === 'revealing' && sample.maxChroma <= 1), 'Every paint shape is monochrome while revealing Design Scraper');
  } else {
    assert.ok(samples.every(sample => sample.maxChroma > 100), 'Entering Mix It restores and preserves its rainbow palette');
  }
  paintTransitions.push({ mode, width: suffix, samples });
}

try {
  const reduced = await open('reduce');
  await still(reduced.page, 'single', 'Reduced motion leaves the studio still');
  await switchWorld(reduced.page, 'mix');
  await settled(reduced.page);
  await still(reduced.page, 'mix', 'Reduced motion leaves the surreal world still');
  assert.equal(await reduced.page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity).length), 0);
  assert.equal(await reduced.page.evaluate(() => window.__worldPhases.includes('covering')), false, 'Reduced motion must bypass paint navigation');
  assert.equal(await reduced.page.locator('.mix-paint-sculpture').evaluate(element => getComputedStyle(element).opacity), '1');
  checks.push('Reduced motion keeps both distinct worlds readable and bypasses paint navigation');
  unexpectedNetwork.push(...reduced.unexpected);
  await reduced.context.close();

  const live = await open('no-preference');
  const { page } = live;
  const basePaper = await page.locator('[data-experience]').evaluate(element => getComputedStyle(element).getPropertyValue('--paper'));
  await moving(page, 'single');
  await page.getByLabel('Website URL', { exact: true }).fill('https://single.example/');
  await captureTransition(page, 'mix', '1440');
  assert.ok(live.artworkRequests.length > 0, 'Mix It loads its artwork when entered');
  assert.notEqual(await page.locator('[data-experience]').evaluate(element => getComputedStyle(element).getPropertyValue('--paper')), basePaper, 'The two worlds must have distinct surfaces');
  await page.getByLabel('First website URL').fill('https://one.example/');
  await page.getByLabel('Second website URL').fill('https://two.example/');
  await page.getByLabel('Mix balance').fill('-25');
  await moving(page, 'mix');
  checks.push('Single stays minimal with no rainbow asset download; Mix It mounts a distinct animated world');

  await page.getByRole('button', { name: 'Pause animations', exact: true }).click();
  await still(page, 'mix', 'Manual pause stops actual surreal-world playback');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await still(page, 'mix', 'OS preference changes must preserve the manual pause');
  const pausedHeading = await page.locator('.experience-headline').evaluate(async element => {
    const before = getComputedStyle(element);
    const snapshot = { opacity: before.opacity, transform: before.transform };
    await new Promise(resolve => setTimeout(resolve, 180));
    const after = getComputedStyle(element);
    return { before: snapshot, after: { opacity: after.opacity, transform: after.transform } };
  });
  assert.equal(pausedHeading.before.opacity, '1', 'A manually paused hero must remain visible when OS reduced motion is disabled');
  assert.deepEqual(pausedHeading.after, pausedHeading.before, 'A manually paused hero must not replay its entrance after an OS preference change');
  await switchWorld(page, 'single');
  await settled(page);
  await still(page, 'single', 'Pause survives returning to the studio');
  assert.equal(await page.getByLabel('Website URL').inputValue(), 'https://single.example/');
  await switchWorld(page, 'mix');
  await settled(page);
  await still(page, 'mix', 'Pause survives re-entering Mix It');
  assert.equal(await page.locator('.mix-paint-sculpture').evaluate(element => getComputedStyle(element).opacity), '1');
  await page.getByRole('button', { name: 'Resume animations', exact: true }).click();
  await moving(page, 'mix');
  checks.push('Pause/resume freezes actual transforms and keeps both scenes visible across world changes');
  checks.push('Changing OS motion preference preserves manual pause and full hero visibility');

  await captureTransition(page, 'single', '1440');
  await switchWorld(page, 'mix');
  await switchWorld(page, 'single');
  await switchWorld(page, 'mix');
  await settled(page);
  assert.equal(await page.locator('.world-transition').getAttribute('data-target'), 'mix');
  assert.equal(await page.getByLabel('First website URL').inputValue(), 'https://one.example/');
  assert.equal(await page.getByLabel('Second website URL').inputValue(), 'https://two.example/');
  assert.equal(await page.getByLabel('Mix balance').inputValue(), '-25');
  checks.push('Paint covers and reveals in both directions; rapid switching leaves the latest world active and preserves both forms');

  await page.getByRole('link', { name: 'Mix It home', exact: true }).click();
  await ready(page, 'mix');
  await page.getByRole('contentinfo').getByRole('button', { name: 'Back to Design Scraper', exact: true }).click();
  await ready(page, 'single');
  await settled(page);
  await page.waitForFunction(() => scrollY < 1);
  assert.equal(await page.locator('#main-content').evaluate(element => element === document.activeElement), true, 'Footer world navigation must move keyboard focus to the main content');
  checks.push('Each brand stays in its own world; the footer return opens Design Scraper at the top');

  for (const mode of ['single', 'mix']) {
    if (await page.locator('[data-experience]').getAttribute('data-experience') !== mode) { await switchWorld(page, mode); await settled(page); }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode} has no overflow at ${width}px`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${artifacts}/${mode === 'single' ? 'design-scraper' : 'mix-it'}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await captureTransition(page, 'single', '390');
  await captureTransition(page, 'mix', '390');
  checks.push('Return paint starts colorful, gradually becomes monochrome and restores its rainbow on re-entry at desktop and mobile widths');
  checks.push('Both worlds and paint navigation render at desktop, tablet and mobile widths without page overflow');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  unexpectedNetwork.push(...live.unexpected);
  await live.context.close();

  // A short local demonstration clip, entirely without providers or analysis.
  const clip = await open('no-preference', true);
  const video = clip.page.video();
  await moving(clip.page, 'single');
  await clip.page.waitForTimeout(650);
  await switchWorld(clip.page, 'mix');
  await settled(clip.page);
  await clip.page.waitForTimeout(1500);
  await switchWorld(clip.page, 'single');
  await settled(clip.page);
  await clip.page.waitForTimeout(650);
  unexpectedNetwork.push(...clip.unexpected);
  await clip.context.close();
  await video.saveAs(`${artifacts}/design-scraper-mix-it.webm`);
  checks.push('Local video records the actual two-way paint transition');

  assert.equal(analyses, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedNetwork, []);
  await writeFile('reports/worlds-motion-replay.json', JSON.stringify({ analyses, checks, errors, unexpectedNetwork, paintTransitions, video: `${artifacts}/design-scraper-mix-it.webm` }, null, 2));
  console.log(JSON.stringify({ mode: 'worlds-motion-replay', analyses, checks: checks.length, errors }));
} finally { await browser.close(); }
