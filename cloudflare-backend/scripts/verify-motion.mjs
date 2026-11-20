// Real GSAP playback, two visual worlds and paint navigation, with no analysis.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork, replayApiPattern } from './replay-network.mjs';

const site = process.env.PAGES_URL;
const api = process.env.API_URL || 'https://design-scraper-phase8.lucas-malizia27.workers.dev';
assert.ok(site && ['localhost', '127.0.0.1'].includes(new URL(site).hostname), 'Local UI only');
const artifacts = '../output/playwright/worlds';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch();
const checks = [], errors = [], unexpectedNetwork = [], paintTransitions = [];
const scene = { single: '.studio-scene', mix: '.mix-world' };
const blenderCanvas = '.mix-world .mix-blender-scene canvas';
let analyses = 0;

async function open(reducedMotion, record = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, reducedMotion, serviceWorkers: 'block',
    ...(record ? { recordVideo: { dir: `${artifacts}/video`, size: { width: 1440, height: 1000 } } } : {}),
  });
  const unexpected = await isolateReplayNetwork(context, site);
  // Focusing a URL field reads the shared allowance; nothing else may leave the page.
  await context.route(replayApiPattern(site, api), async route => {
    const headers = { 'access-control-allow-origin': new URL(site).origin, 'access-control-allow-methods': 'GET, OPTIONS' };
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
    window.__mixDraws = new WeakMap();
    window.__mixPaintStarts = [];
    const seenPaintSurfaces = new WeakSet();
    new MutationObserver(() => {
      const wall = document.querySelector('.experience-shell > .mix-stains');
      if (wall && !seenPaintSurfaces.has(wall)) {
        seenPaintSurfaces.add(wall); window.__mixPaintStarts.push(wall.childElementCount);
      }
    }).observe(document, { childList: true, subtree: true });
    for (const Context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const method of ['drawArrays', 'drawElements']) {
        const draw = Context.prototype[method];
        Context.prototype[method] = function (...args) {
          const result = draw.apply(this, args);
          if (this.canvas.closest?.('.mix-blender-scene')) {
            window.__mixDraws.set(this.canvas, 1 + (window.__mixDraws.get(this.canvas) || 0));
          }
          return result;
        };
      }
    }
    window.addEventListener('securitypolicyviolation', event => console.error(`CSP violation: ${event.violatedDirective}`));
  });
  page.on('request', request => {
    if (/\/api\/(analyze|mix)$/.test(request.url())) analyses++;
    if (/\/images\/(?:mix-it-paint-sculpture|mix-pigment-vortex)\.(?:webp|png)$/.test(new URL(request.url()).pathname)) artworkRequests.push('mix-artwork');
  });
  if (reducedMotion === 'no-preference') await page.addInitScript(() => {
    const frames = window.__openingStudyFrames = {};
    const cadence = window.__pressCadence = { samples: 0, changes: 0 };
    let previousOutline;
    const observer = new MutationObserver(changes => {
      const target = changes.find(change => change.target.dataset?.study === 'hero')?.target;
      if (!target) return;
      const progress = Number(target.dataset.progress);
      // Count changes to visible ink while the press is coming apart,
      // independent of the machine's refresh rate and the deliberate holds.
      if (progress > .08 && progress < .22) {
        const outline = target.querySelector('[data-stroke="outline"]')?.getAttribute('d');
        cadence.samples++;
        if (outline && outline !== previousOutline) cadence.changes++;
        previousOutline = outline;
      }
      const phase = target.dataset.phase;
      if (!['exploded', 'registered', 'contact', 'proof'].includes(phase) || frames[phase]) return;
      frames[phase] = {
        platen: Number(target.dataset.platenAngle),
        handle: Number(target.dataset.handleAngle),
        ink: target.querySelector('[data-motion="impression"]').getAttribute('opacity'),
        y: scrollY,
      };
      if (frames.proof) observer.disconnect();
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-progress'] });
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
  if (mode === 'mix') {
    await page.locator('.mix-world[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  }
}

async function still(page, mode, label) {
  if (mode === 'single') {
    await page.locator(scene.single).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.press-hero-drawing').dataset.progress === '1.0000');
    const study = page.locator('.press-hero-drawing');
    assert.ok(await study.getByRole('img').isVisible(), label);
    assert.equal(await study.getAttribute('data-playback'), 'still');
    return;
  }
  await page.waitForFunction(() => document.querySelector('.mix-world').dataset.playback ===
    (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'paused'));
  const snapshot = () => page.locator(blenderCanvas).evaluate(canvas => ({
    time: canvas.closest('.mix-world').dataset.time,
    draws: window.__mixDraws.get(canvas) || 0,
  }));
  const before = await snapshot();
  assert.ok(before.draws > 0, 'The blender has actually rendered with WebGL');
  await page.waitForTimeout(180);
  assert.deepEqual(await snapshot(), before, label);
  assert.equal(await page.locator('.mix-vortex-artwork, .mix-vortex-canvas').count(), 0,
    'The retired paint-vortex renderer is not mounted');
}

async function watchSingle(page) {
  await page.waitForFunction(() => window.__openingStudyFrames?.proof, null, { timeout: 15000 });
  const cadence = await page.evaluate(() => window.__pressCadence);
  assert.ok(cadence.samples >= 10 && cadence.changes >= .8 * cadence.samples,
    `Moving press should redraw on most ticks; saw ${cadence.changes} changes over ${cadence.samples} ticks`);
  const frames = await page.evaluate(() => window.__openingStudyFrames);
  assert.deepEqual(Object.keys(frames), ['exploded', 'registered', 'contact', 'proof'], 'The press displays all four phases in order');
  for (const pose of Object.values(frames)) assert.ok(Number.isFinite(pose.platen) && Number.isFinite(pose.handle), 'Poses carry finite joint angles');
  assert.equal(frames.exploded.ink, '0');
  assert.equal(frames.registered.ink, '0', 'The sheet is blank before contact');
  assert.notEqual(frames.contact.handle, frames.registered.handle, 'The operator lowers the handle to make the impression');
  assert.notEqual(frames.contact.platen, frames.registered.platen, 'The handle closes the platen to print');
  assert.equal(frames.proof.platen, frames.registered.platen, 'The platen opens before the printed sheet is removed');
  assert.equal(frames.proof.ink, '1');
  assert.equal(frames.exploded.y, 0, 'The hero starts on arrival');
  assert.equal(frames.proof.y, frames.exploded.y, 'The hero finishes without scrolling');
}

async function watchMixInView(page) {
  const world = page.locator(scene.mix);
  await world.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => document.querySelector('.mix-world').dataset.phase === 'continuous-mix' && document.querySelector('.mix-world').dataset.playback === 'playing');
  const canvas = page.locator(blenderCanvas);
  const title = page.locator('.experience-headline');
  // Sample the same visible part of the scene without auto-scrolling its oversized canvas.
  const box = await world.boundingBox();
  const viewport = page.viewportSize();
  const x = Math.max(0, Math.ceil(box.x)), y = Math.max(0, Math.ceil(box.y));
  const clip = {
    x, y,
    width: Math.min(viewport.width, Math.floor(box.x + box.width)) - x,
    height: Math.min(viewport.height, Math.floor(box.y + box.height)) - y,
  };
  assert.ok(clip.width > 0 && clip.height > 0, 'The running scene is visible');
  const before = await page.screenshot({ clip });
  const draws = () => canvas.evaluate(el => window.__mixDraws.get(el) || 0);
  const initialDraws = await draws();
  const titleBox = await title.boundingBox();
  const time = Number(await world.getAttribute('data-time'));
  await page.waitForFunction(t => Number(document.querySelector('.mix-world').dataset.time) > t + 400, time);
  assert.ok(await draws() > initialDraws, 'The blender renders new WebGL frames');
  assert.ok(!(await page.screenshot({ clip })).equals(before), 'The blender and airborne paint keep moving');
  assert.deepEqual(await title.boundingBox(), titleBox, 'Paint impacts do not move the title layout');
  // The compact workspace can leave the blender visible even at the footer.
  // Supply real offscreen space instead of assuming the old tall hero layout.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'motion-offscreen-space';
    // Leave clearance for fractional CSS pixels at responsive layout boundaries.
    spacer.style.height = `${innerHeight + 64}px`;
    document.body.append(spacer);
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  assert.ok(await page.locator('.experience-shell').evaluate(el => el.getBoundingClientRect().bottom < 0),
    'The complete paint surface is outside the viewport');
  await still(page, 'mix', 'The offscreen blender stops rendering');
  const stopped = Number(await world.getAttribute('data-time'));
  await world.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(t => Number(document.querySelector('.mix-world').dataset.time) > t + 100, stopped);
  assert.equal(await world.getAttribute('data-phase'), 'continuous-mix', 'Re-entry resumes continuous mixing');
  await page.locator('#motion-offscreen-space').evaluate(el => el.remove());
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
  assert.equal(await reduced.page.locator('.press-hero-drawing button').count(), 0);
  assert.equal(await reduced.page.locator('[data-motion="impression"] use').evaluate(part => part.getBBox().width > 0), true);
  await switchWorld(reduced.page, 'mix');
  await settled(reduced.page);
  await still(reduced.page, 'mix', 'Reduced motion leaves the surreal world still');
  assert.equal(await reduced.page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity).length), 0);
  assert.equal(await reduced.page.evaluate(() => window.__worldPhases.includes('covering')), false, 'Reduced motion must bypass paint navigation');
  assert.ok(await reduced.page.locator(blenderCanvas).isVisible());
  const fallbackPage = await reduced.context.newPage();
  await fallbackPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await fallbackPage.goto(site);
  await fallbackPage.getByRole('button', { name: 'Enter Mix It' }).click();
  await fallbackPage.locator('.mix-world[data-renderer="fallback"]').waitFor();
  assert.ok(await fallbackPage.locator('.mix-scene-error').isVisible(), 'Missing WebGL has a readable fallback');
  assert.ok(await fallbackPage.getByLabel('First website URL').isEnabled());
  await fallbackPage.close();
  checks.push('Reduced motion keeps both distinct worlds readable and bypasses paint navigation');
  unexpectedNetwork.push(...reduced.unexpected);
  await reduced.context.close();

  const live = await open('no-preference');
  const { page } = live;
  const basePaper = await page.locator('[data-experience]').evaluate(element => getComputedStyle(element).getPropertyValue('--paper'));
  await watchSingle(page);
  // Start below the fold so the test controls the press's first entry.
  const printPage = await live.context.newPage();
  await printPage.setViewportSize({ width: 1280, height: 500 });
  await printPage.goto(site);
  const proof = printPage.locator('[data-study="print"]');
  await proof.waitFor({ state: 'attached' });
  assert.equal(await proof.getByRole('button').count(), 0);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 500 }]) {
    await printPage.setViewportSize(viewport);
    const size = await proof.evaluate(el => {
      const { x, width, height } = el.getBoundingClientRect();
      return { x, width, height, pageWidth: document.documentElement.clientWidth };
    });
    assert.equal(size.x, 0, 'The print extends to the left screen edge');
    assert.equal(size.width, size.pageWidth, 'The print extends to the right screen edge');
    assert.ok(size.height < viewport.height * .85, 'The three workshop studies form a compact banner');
    const captions = await proof.locator('li').evaluateAll(steps => steps.map(step => {
      const numeral = step.querySelector('.folio-number'), title = step.querySelector('h3');
      const center = element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left + bounds.width / 2;
      };
      const drawingCenter = center(step.querySelector('svg'));
      return {
        number: numeral.textContent,
        separate: !title.contains(numeral),
        larger: parseFloat(getComputedStyle(numeral).fontSize) > parseFloat(getComputedStyle(title).fontSize),
        sameFamily: getComputedStyle(numeral).fontFamily === getComputedStyle(title).fontFamily,
        aligned: [numeral, title, step.querySelector('p')].every(el => Math.abs(center(el) - drawingCenter) < 2),
        centeredText: getComputedStyle(title).textAlign === 'center' && getComputedStyle(step.querySelector('p')).textAlign === 'center',
      };
    }));
    assert.deepEqual(captions.map(caption => caption.number), ['1', '2', '3']);
    assert.ok(captions.every(caption => caption.separate && caption.larger && caption.sameFamily && caption.aligned && caption.centeredText),
      'Each independent number, title and caption share the drawing’s centerline');
  }
  assert.ok(await proof.evaluate(el => el.getBoundingClientRect().top >= innerHeight), 'The press starts offscreen');
  await proof.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await printPage.waitForFunction(() => Number(document.querySelector('.print-folio').dataset.progress) > .10);
  await printPage.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await printPage.waitForFunction(() => document.querySelector('.print-folio').dataset.playback === 'paused');
  const pausedAt = Number(await proof.getAttribute('data-progress'));
  await printPage.waitForTimeout(240);
  assert.equal(Number(await proof.getAttribute('data-progress')), pausedAt, 'Leaving the viewport freezes the current sheet');
  const resumeY = await proof.evaluate(el => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    return scrollY;
  });
  await printPage.waitForFunction(() => document.querySelector('.print-folio').dataset.playback === 'playing');
  assert.ok(Number(await proof.getAttribute('data-progress')) >= pausedAt, 'Re-entering continues the interrupted print');
  const [poseCounts] = await Promise.all([
    proof.evaluate(banner => {
      const studies = [...banner.querySelectorAll('li svg')].map(svg => ({
        parts: [...svg.querySelectorAll('[data-motion-part]')], poses: new Set(),
      }));
      return new Promise(resolve => {
        function sample() {
          for (const { parts, poses } of studies) {
            poses.add(parts.map(el => el.getAttribute('transform') || '').join('|'));
          }
          if (banner.dataset.playback === 'complete') resolve(studies.map(study => study.poses.size));
          else requestAnimationFrame(sample);
        }
        sample();
      });
    }),
    printPage.waitForFunction(() => document.querySelector('.print-folio').dataset.playback === 'complete', null, { timeout: 15000 }),
  ]);
  assert.ok(poseCounts.length === 3 && poseCounts.every(count => count > 5), 'Each station has a moving physical part');
  assert.equal(await printPage.evaluate(() => scrollY), resumeY, 'The press finishes without scrolling');
  assert.equal(await proof.locator('li svg').count(), 3);
  await printPage.close();
  checks.push('The proof press starts in view, pauses outside it and finishes the three steps in order after re-entry');
  await page.getByLabel('Website URL', { exact: true }).fill('https://single.example/');
  await captureTransition(page, 'mix', '1440');
  assert.equal(await page.locator('.mix-paint-entrance').count(), 0, 'The rejected collision entrance is removed');
  await page.waitForFunction(() => document.querySelector('.mix-world').dataset.phase === 'continuous-mix' && document.querySelector('.mix-world').dataset.playback === 'playing');
  assert.equal(await page.locator('.experience-headline').evaluate(el => getComputedStyle(el).transform), 'none');
  assert.equal(await page.locator('.analysis-intro').evaluate(el => getComputedStyle(el).getPropertyValue('--paper').trim()), '#171815');
  await page.waitForFunction(() => Number(document.querySelector('.analysis-intro').dataset.inkLetters) > 0 && Number(document.querySelector('.analysis-intro').dataset.inkBackground) > 0);
  assert.match(await page.locator('.experience-headline').getAttribute('aria-label'), /MAKE A BEAUTIFUL MESS/);
  checks.push('The Home blender runs on charcoal in Mix It; flying paint stains the existing title and background');
  assert.equal(await page.evaluate(() => window.__mixPaintStarts.at(-1)), 0, 'Mix It enters without pre-existing stains');
  await page.waitForFunction(() => document.querySelectorAll('.mix-letter.is-inked').length >= 8);
  assert.equal(await page.locator('.experience-shell > .mix-stains').count(), 1, 'Deposits share a page-wide surface');
  assert.equal(await page.locator('.mix-workspace').evaluate(el => getComputedStyle(el, '::before').backgroundImage), 'none');
  checks.push('A clean page receives large opening impacts, with paint spanning adjacent title letters');
  assert.notEqual(await page.locator('[data-experience]').evaluate(element => getComputedStyle(element).getPropertyValue('--paper')), basePaper, 'The two worlds must have distinct surfaces');
  const mixBanner = page.locator('.mix-banner');
  const bannerWord = mixBanner.locator('.mix-banner-word').first();
  const revealPortion = fraction => mixBanner.evaluate((banner, portion) => {
    const rect = banner.getBoundingClientRect();
    scrollBy({ top: rect.top + rect.height * portion - innerHeight, behavior: 'instant' });
  }, fraction);
  for (const fraction of [0.1, 0.5, 0.75]) {
    await revealPortion(fraction);
    await page.waitForTimeout(200);
    assert.equal(await bannerWord.evaluate(word => getComputedStyle(word).opacity), '0',
      `Banner words stay at rest with ${fraction * 100}% of the band visible`);
  }
  await revealPortion(0.85);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.mix-banner-word')).opacity) > 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.mix-banner-word')].every(word => getComputedStyle(word).opacity === '1'));
  checks.push('Banner waits through partial exposure and reveals its words when most of the band is visible');
  await page.waitForSelector('.mix-stains path[data-region="banner"]');
  await page.waitForFunction(() => {
    const lip = document.querySelector('.mix-banner').getBoundingClientRect().top;
    const pool = document.querySelector('[data-region="ledge-pool"]');
    const piece = document.querySelector('[data-region="floor-piece"]');
    if (!pool || !piece) return false;
    const paint = pool.getBoundingClientRect(), object = piece.getBoundingClientRect();
    return paint.top < lip && paint.bottom > lip + 3 && Math.abs(object.bottom - lip) < 2;
  });
  checks.push('Paint collects above the banner lip, drips below it, and a landed blender piece rests on the divider');
  assert.equal(await page.locator('.drawing-footer').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Footer does not hide the paint');
  checks.push('Lower-page paint arrives on exposure and continues behind the transparent footer');
  await watchMixInView(page);
  await page.getByLabel('First website URL').fill('https://one.example/');
  await page.getByLabel('Second website URL').fill('https://two.example/');
  await page.getByLabel('Mix balance').fill('75');
  checks.push('Single stays minimal with no rainbow asset download; Mix It mounts the shared Home blender');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await still(page, 'mix', 'System reduced motion stops surreal-world playback');
  const pausedHeading = await page.locator('.experience-headline').evaluate(async element => {
    const before = getComputedStyle(element);
    const snapshot = { opacity: before.opacity, transform: before.transform };
    await new Promise(resolve => setTimeout(resolve, 180));
    const after = getComputedStyle(element);
    return { before: snapshot, after: { opacity: after.opacity, transform: after.transform } };
  });
  assert.equal(pausedHeading.before.opacity, '1', 'The hero remains visible with reduced motion');
  assert.deepEqual(pausedHeading.after, pausedHeading.before, 'The hero stays still with reduced motion');
  await switchWorld(page, 'single');
  await settled(page);
  await still(page, 'single', 'Reduced motion survives returning to the studio');
  assert.equal(await page.getByLabel('Website URL').inputValue(), 'https://single.example/');
  await switchWorld(page, 'mix');
  await settled(page);
  await still(page, 'mix', 'Reduced motion survives re-entering Mix It');
  assert.ok(await page.locator(blenderCanvas).isVisible());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator(scene.mix).scrollIntoViewIfNeeded();
  await watchMixInView(page);
  checks.push('Reduced motion holds both scenes still across mode changes, and the blender resumes when motion is enabled');

  await captureTransition(page, 'single', '1440');
  await switchWorld(page, 'mix');
  await switchWorld(page, 'single');
  await switchWorld(page, 'mix');
  await settled(page);
  assert.equal(await page.locator('.world-transition').getAttribute('data-target'), 'mix');
  assert.equal(await page.getByLabel('First website URL').inputValue(), 'https://one.example/');
  assert.equal(await page.getByLabel('Second website URL').inputValue(), 'https://two.example/');
  assert.equal(await page.getByLabel('Mix balance').inputValue(), '75');
  checks.push('Paint covers and reveals in both directions; rapid switching leaves the latest world active and preserves both forms');

  await page.getByRole('link', { name: 'Mix It home', exact: true }).click();
  await ready(page, 'mix');
  await page.getByRole('banner').getByRole('button', { name: 'Back to Design Scraper', exact: true }).click();
  await ready(page, 'single');
  await settled(page);
  await page.waitForFunction(() => scrollY < 1);
  assert.equal(await page.locator('#main-content').evaluate(element => element === document.activeElement), true, 'Header world navigation must move keyboard focus to the main content');
  checks.push('Each brand stays in its own world; the header return opens Design Scraper at the top');

  for (const mode of ['single', 'mix']) {
    if (await page.locator('[data-experience]').getAttribute('data-experience') !== mode) { await switchWorld(page, mode); await settled(page); }
    for (const width of mode === 'mix' ? [320, 390, 540, 541, 760, 761, 900, 901, 1024, 1440, 1920, 2560, 3840] : [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode} has no overflow at ${width}px`);
      if (mode === 'mix') {
        const paintBounds = await page.evaluate(() => {
          const canvas = document.querySelector('.mix-blender-scene canvas').getBoundingClientRect();
          const cell = document.querySelector('.mix-blender-scene').getBoundingClientRect();
          return { left: canvas.left, right: canvas.right, topExtra: cell.top - canvas.top, bottomExtra: canvas.bottom - cell.bottom,
            overflow: getComputedStyle(document.querySelector('.mix-blender-scene')).overflow };
        });
        assert.ok(paintBounds.left <= 1 && paintBounds.right >= width - 1, `Airborne pieces cross columns at ${width}px`);
        assert.ok(paintBounds.topExtra > 80 && paintBounds.bottomExtra > 100, `Vertical flight overscan at ${width}px`);
        assert.equal(paintBounds.overflow, 'visible');
      }
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
  await watchSingle(clip.page);
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
