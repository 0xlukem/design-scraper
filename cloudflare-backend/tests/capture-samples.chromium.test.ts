import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { Page as CapturePage } from '@cloudflare/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { captureSamples } from '../src/capture-samples';
import { config } from '../src/config';
import { ApiError } from '../src/errors';
import { captureReadiness } from '../src/capture-readiness';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });
const profile = config({ CAPTURE_STRATEGY: 'samples', SCRAPE_TIMEOUT_MS: '15000' });
const fixture = (seed = 0) => `<style>body{margin:0;font-family:Arial;color:#14283c;background:#fff}header{height:200px}section{height:1100px;padding:20px}h1{font-size:32px}h2{font-size:24px}button{padding:12px;background:#248;color:white}#outside{height:100px}</style>
  <header><nav><a href="#">Public navigation</a></nav><h1>A useful design reference ${seed}</h1><p>Visible introductory copy with real measured typography and colors.</p></header>
  <section><h2>First content section</h2><p>A representative paragraph of useful content.</p><button>First action</button></section>
  <section><h2>Second content section</h2><p>Another independent content region.</p><button>Second action</button></section>
  <section><h2>Third content section</h2><p>Further content with a different position.</p><button>Third action</button></section>
  <div style="height:1800px"></div><div id="outside">Outside the sampled region</div>`;
async function page(html = fixture()) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.setContent(html);
  return page;
}
const run = (page: Page, ready: (ms: number) => Promise<void> = async () => {}, c = profile,
  healthy: () => void = () => {}) => captureSamples(page as unknown as CapturePage, c, Date.now() + 12000, Date.now(), ready, healthy);

it.each([29, 71, 113])('retains coherent samples when document height changes by %s px outside the photograph', async delta => {
  const p = await page(fixture(delta));
  const screenshot = p.screenshot.bind(p);
  p.screenshot = async options => {
    const photograph = await screenshot(options);
    await p.locator('#outside').evaluate((element, delta) => { element.style.height = `${element.getBoundingClientRect().height + delta}px`; }, delta);
    return photograph;
  };
  try {
    const result = await run(p);
    expect(result.samples.length).toBeGreaterThan(1);
    expect(result.rejected).toEqual([]);
    expect(result.quality).toBe('sufficient');
    expect(result.samples.every(sample => sample.viewport.width === 1440 && sample.region.y + 900 <= 4000)).toBe(true);
    expect((result.data.measurements as { samples: unknown[] }).samples.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(result.data)).not.toContain('Outside the sampled region');
    if (delta === 29) {
      await mkdir('../output/playwright/capture-samples', { recursive: true });
      for (const sample of result.samples) await writeFile(`../output/playwright/capture-samples/${sample.id}.jpg`, Buffer.from(sample.image, 'base64'));
    }
  } finally { await p.close(); }
});

it('retains valid context and rejects only optional regions that change during their photograph', async () => {
  const p = await page();
  const screenshot = p.screenshot.bind(p);
  p.screenshot = async options => {
    const photograph = await screenshot(options);
    await p.evaluate(() => {
      if (scrollY > 0) for (const heading of document.querySelectorAll('section h2'))
        (heading as HTMLElement).style.paddingTop = `${parseInt((heading as HTMLElement).style.paddingTop || '0') + 5}px`;
    });
    return photograph;
  };
  try {
    const result = await run(p);
    expect(result.quality).toBe('partial');
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].anchor).toBe('context');
    expect(result.rejected.every(sample => sample.code === 'CAPTURE_SAMPLE_UNSTABLE')).toBe(true);
  } finally { await p.close(); }
});

it('rejects a dependency that fails during the photograph before sealing that sample', async () => {
  const p = await page();
  let checked = 0;
  try {
    const result = await captureSamples(p as unknown as CapturePage, profile, Date.now() + 12000, Date.now(), async () => {}, () => {}, {
      validate: async () => { if (++checked === 1) throw new ApiError('CAPTURE_INCOMPLETE', 'A visible resource failed during this photograph.', 422, true); },
    });
    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.samples.every(sample => sample.anchor !== 'context')).toBe(true);
    expect(result.rejected).toEqual([{ anchor: 'context', code: 'CAPTURE_INCOMPLETE', reason: 'A visible resource failed during this photograph.' }]);
  } finally { await p.close(); }
});

it('accepts browser scroll anchoring when outside growth leaves the photographed elements unchanged', async () => {
  const p = await page(fixture().replace('</header>', '</header><div id="above" style="height:1px"></div>'));
  const screenshot = p.screenshot.bind(p);
  p.screenshot = async options => {
    const photograph = await screenshot(options);
    await p.evaluate(async () => {
      if (scrollY === 0) return;
      const above = document.querySelector<HTMLElement>('#above')!;
      above.style.height = `${above.getBoundingClientRect().height + 29}px`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    return photograph;
  };
  try {
    const result = await run(p);
    expect(result.rejected).toEqual([]);
    expect(result.samples.some(sample => sample.scroll_y_after > sample.region.y)).toBe(true);
  } finally { await p.close(); }
});

it('compares large repeated computed values inside Chromium and returns compact stability observations', async () => {
  const family = 'A'.repeat(20_000);
  const p = await page(`<style>body{font-family:"${family}";line-height:16px}p{margin:0}</style><h1>A large-font design reference</h1>
    ${'<p>Readable repeated content</p>'.repeat(35)}`);
  const evaluate = p.evaluate.bind(p);
  const observationBytes: number[] = [];
  p.evaluate = (async (...args: Parameters<typeof evaluate>) => {
    const result = await evaluate(...args);
    if (result && typeof result === 'object' && 'region' in result && 'useful' in result)
      observationBytes.push(JSON.stringify(result).length);
    return result;
  }) as typeof p.evaluate;
  try {
    const result = await run(p);
    expect(result.samples).toHaveLength(1);
    expect(observationBytes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...observationBytes)).toBeLessThan(512);
  } finally { await p.close(); }
});

it('retries when measured letter spacing changes during a photograph without moving the element', async () => {
  const p = await page('<h1 style="width:1000px">A stable width reference</h1><p>Visible text with measured typography.</p>');
  const screenshot = p.screenshot.bind(p);
  let attempts = 0;
  p.screenshot = async options => {
    if (++attempts === 1) await p.locator('h1').evaluate(element => { element.style.letterSpacing = '8px'; });
    return screenshot(options);
  };
  try {
    const result = await run(p);
    expect(attempts).toBe(2);
    expect(result.data.measurements).toMatchObject({ samples: expect.arrayContaining([
      expect.objectContaining({ tag: 'h1', styles: expect.objectContaining({ letterSpacing: '8px' }) }),
    ]) });
  } finally { await p.close(); }
});

it('re-extracts changed local styles instead of retaining measurements from a different image state', async () => {
  const p = await page();
  const screenshot = p.screenshot.bind(p);
  let first = true;
  p.screenshot = async options => {
    if (first) { first = false; await p.locator('h1').evaluate(element => { element.style.fontSize = '48px'; }); }
    return screenshot(options);
  };
  try {
    const result = await run(p);
    const samples = (result.data.measurements as { samples: { tag: string; styles: Record<string, string>; capture_sample: string }[] }).samples;
    expect(samples.find(sample => sample.tag === 'h1')?.styles.fontSize).toBe('48px');
    expect(samples.every(sample => result.samples.some(image => image.id === sample.capture_sample))).toBe(true);
  } finally { await p.close(); }
});

it.each([
  '<main aria-busy="true"><h1>Loading the application</h1><p>Please wait while content is being prepared.</p></main>',
  '<title>Just a moment…</title><h1>Verify that you are human</h1><p>Complete verification to continue to the requested content.</p>',
  '<main><h1>Actual content behind a modal</h1><p>This content must not become observed evidence.</p></main><div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white;z-index:999"><h1>Manage your consent</h1><p>This is a blocking dialog with enough text to resemble page content.</p></div>',
])('rejects loading shells and blocked content before provider processing', async html => {
  const p = await page(html);
  try { await expect(run(p)).rejects.toMatchObject({ code: 'CAPTURE_EVIDENCE_INSUFFICIENT' }); }
  finally { await p.close(); }
});

it('accepts a genuinely short page without requiring external stylesheets or absent components', async () => {
  const p = await page('<h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p>');
  try {
    const result = await run(p);
    expect(result.quality).toBe('sufficient'); expect(result.samples).toHaveLength(1);
  } finally { await p.close(); }
});

it('waits for delayed hydration before binding sample measurements to the rendered nodes', async () => {
  const p = await page('<main aria-busy="true">Loading…</main><script>setTimeout(() => { document.body.innerHTML = "<h1>A hydrated design reference</h1><p>Real content replaces the original loading shell.</p>"; }, 300)</script>');
  try {
    const result = await run(p);
    expect(result.quality).toBe('sufficient');
    expect((result.data.measurements as { samples: { tag: string }[] }).samples.some(row => row.tag === 'h1')).toBe(true);
  } finally { await p.close(); }
});

it('pauses local Web Animations for paired image and CSS evidence, then restores their playback', async () => {
  const p = await page('<style>@keyframes change{from{color:rgb(255,0,0)}to{color:rgb(0,0,255)}}h1{animation:change 1s infinite alternate}</style><h1>An animated design reference</h1><p>Real typography and colors are captured in one observed animation state.</p>');
  try {
    const result = await run(p);
    expect(result.samples).toHaveLength(1);
    expect(await p.evaluate(() => document.getAnimations().some(animation => animation.playState === 'running'))).toBe(true);
  } finally { await p.close(); }
});

it('does not convert safety failures into partial success', async () => {
  const p = await page();
  let calls = 0;
  const ready = vi.fn(async () => { if (++calls > 1) throw new ApiError('UNSAFE_URL', 'Unsafe fixture destination', 422); });
  try { await expect(run(p, ready)).rejects.toMatchObject({ code: 'UNSAFE_URL' }); }
  finally { await p.close(); }
});

it('enforces an aggregate image byte ceiling instead of applying it separately per sample', async () => {
  const p = await page();
  const screenshot = p.screenshot.bind(p);
  p.screenshot = async options => { await screenshot(options); return Buffer.alloc(6000); };
  try {
    await expect(run(p, undefined, { ...profile, screenshotBytes: 10000 })).rejects.toMatchObject({ code: 'SCREENSHOT_TOO_LARGE' });
  } finally { await p.close(); }
});

it('retains evidence when an optional region becomes unavailable, sharing the original inspection budget', async () => {
  const p = await page();
  let calls = 0;
  try {
    const result = await run(p, async () => {
      if (++calls > 1) throw new ApiError('CAPTURE_INCOMPLETE', 'Optional image unavailable', 422, true);
    });
    expect(result.samples).toHaveLength(1); expect(result.quality).toBe('partial');
    expect((result.data.extraction as { inspectedElements: number }).inspectedElements).toBeLessThanOrEqual(profile.elements);
  } finally { await p.close(); }
});

it('does not attribute a replaced node to measurements from its predecessor', async () => {
  const p = await page();
  const screenshot = p.screenshot.bind(p);
  p.screenshot = async options => {
    const image = await screenshot(options);
    await p.evaluate(() => {
      if (!scrollY) return;
      for (const element of document.querySelectorAll('section')) {
        const replacement = element.cloneNode(true) as HTMLElement;
        replacement.style.fontSize = '99px'; element.replaceWith(replacement);
      }
    });
    return image;
  };
  try {
    const result = await run(p);
    expect(result.quality).toBe('partial'); expect(result.samples).toHaveLength(1);
    expect(JSON.stringify(result.data.measurements)).not.toContain('99px');
  } finally { await p.close(); }
});

it('binds the hydrated DOM after resource readiness instead of photographing detached initial nodes', async () => {
  const p = await page();
  let hydrated = false;
  try {
    const result = await run(p, async () => {
      if (hydrated) return;
      hydrated = true;
      await p.locator('header').evaluate(element => {
        const replacement = element.cloneNode(true) as HTMLElement;
        replacement.querySelector('h1')!.style.fontSize = '41px'; element.replaceWith(replacement);
      });
    });
    expect(result.samples[0].anchor).toBe('context');
    const measurements = (result.samples[0].data.measurements as { samples: { tag: string; styles: Record<string, string> }[] }).samples;
    expect(measurements.find(row => row.tag === 'h1')?.styles.fontSize).toBe('41px');
    expect(measurements.some(row => row.styles.fontSize === '32px')).toBe(false);
  } finally { await p.close(); }
});

it('retains a useful image within its deadline over a slow browser protocol', async () => {
  const p = await page('<h1>A complete short design reference</h1><p>Useful static content with corresponding measured styles.</p>');
  const protocol = p as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of ['evaluate', 'evaluateHandle', 'waitForFunction', 'waitForTimeout', 'screenshot']) {
    const original = protocol[method].bind(p);
    protocol[method] = async (...args) => { await new Promise(resolve => setTimeout(resolve, 500)); return original(...args); };
  }
  try {
    const result = await captureSamples(p as unknown as CapturePage, profile, Date.now() + 7200, Date.now(), async () => {
      for (let i = 0; i < 3; i++) await p.evaluate(() => document.fonts.status);
    }, () => {});
    expect(result.samples).toHaveLength(1);
    expect(result.quality).toBe('sufficient');
    expect((result.data.measurements as { samples: unknown[] }).samples.length).toBeGreaterThan(0);
  } finally { await p.close(); }
});

it('does not exhaust the content allowance on document metadata or non-content SVG paths', async () => {
  const p = await page(`<head>${'<meta name="fixture" content="metadata">'.repeat(3100)}</head><body><svg style="display:none">${'<path d="M0 0"></path>'.repeat(3100)}</svg><h1>A useful content reference</h1><p>Rendered text and measurements must still be sampled within the original element allowance.</p></body>`);
  try {
    const result = await run(p);
    expect(result.samples).toHaveLength(1);
    expect(result.quality).toBe('sufficient');
    expect((result.data.measurements as { samples: { tag: string }[] }).samples.some(row => row.tag === 'h1')).toBe(true);
    expect((result.data.extraction as { inspectedElements: number }).inspectedElements).toBeLessThanOrEqual(profile.elements);
  } finally { await p.close(); }
});

it.each([
  '<style>header{height:950px}section{height:1000px;display:grid;grid-template-columns:1fr 1fr}article{padding:30px}</style><header><h1>A generic product landing</h1><p>A real introduction with useful measured styles.</p></header><section><article><h2>Independent card design</h2><p>Card content and typography.</p><button>Choose a plan</button></article></section><section><h2>Another useful component</h2><p>Lower page evidence.</p></section>',
  '<style>nav{position:fixed;top:0;left:0;width:200px;height:100vh;background:#ddd}main{margin-left:220px}section{height:1000px}</style><nav><a href="#">Documentation navigation</a></nav><main><h1>A documentation reference</h1><section><p>Useful documentation with native controls and typography.</p><button>Copy example</button></section><section><h2>A second documentation section</h2><p>Another measured content region.</p></section></main>',
  '<style>header{height:950px}main{display:flex;flex-direction:column;gap:900px}</style><header><h1>A generic application dashboard</h1><p>Application content and measurements.</p></header><main><section><h2>First application panel</h2><p>Observed dashboard information.</p><input aria-label="Filter"></section><section><h2>Another application panel</h2><p>Additional panel information.</p><button>Refresh data</button></section></main>',
])('samples held-out layout structures without any site-specific rules', async html => {
  const p = await page(html);
  try {
    const result = await run(p);
    expect(result.samples.length).toBeGreaterThan(1);
    expect(result.samples.length).toBeLessThanOrEqual(3);
    expect(result.rejected).toEqual([]);
    expect(result.quality).toBe('sufficient');
  } finally { await p.close(); }
});

it('ignores an offscreen font still loading while requiring the fonts used by the photographed viewport', async () => {
  const p = await page('<h1>A visible system-font reference</h1><p>Real content using the loaded system font.</p><p style="position:absolute;top:5000px;font-family:PendingFace">Outside the capture region</p>');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await p.route('**/pending.woff', async route => { await pending; await route.abort(); });
  try {
    await p.evaluate(() => {
      const face = new FontFace('PendingFace', 'url(https://fixture.invalid/pending.woff)');
      document.fonts.add(face); void face.load().catch(() => {});
    });
    await p.waitForFunction(() => document.fonts.status === 'loading');
    const inspect = async (localFonts: boolean) => p.evaluate(`(${captureReadiness})(${JSON.stringify({ height: 4000, viewportOnly: true, waitMs: 0, localFonts })})`) as Promise<{ fontsLoaded: boolean }>;
    expect((await inspect(false)).fontsLoaded).toBe(false);
    expect((await inspect(true)).fontsLoaded).toBe(true);
  } finally { release(); await p.close(); }
});

it('does not extract an element hidden by an overflowing ancestor', async () => {
  const p = await page('<h1>A visible design reference</h1><p>Useful visible typography and color evidence.</p><div style="height:10px;overflow:hidden"><p style="margin-top:100px;font-size:99px">Hidden content is not evidence.</p></div>');
  try {
    const result = await run(p);
    expect(JSON.stringify(result.data.measurements)).not.toContain('99px');
  } finally { await p.close(); }
});
