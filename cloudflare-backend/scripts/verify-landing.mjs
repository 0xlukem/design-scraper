// Local build and saved fixtures only; outbound requests are blocked.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';
const site = process.env.PAGES_URL;
assert.ok(site && ['localhost', '127.0.0.1'].includes(new URL(site).hostname), 'Local landing verification only');
const origin = new URL(site).origin, canonical = 'https://design-scraper.pages.dev/';
const artifacts = '../output/playwright/landing-a';
await mkdir(artifacts, { recursive: true });
const checks = [], errors = [], apiRequests = [], layouts = [];
let quotaReads = 0;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width:1265, height:712 }, reducedMotion:'reduce', serviceWorkers:'block' });
const unexpected = await isolateReplayNetwork(context, origin);
// Activity now reads the public capacity counter after PR #1. Keep this
// navigation local while still rejecting any analysis or provider request.
await context.route('**/api/quotas', async route => {
  assert.equal(route.request().method(), 'GET');
  quotaReads++;
  return route.fulfill({ json: {
    day: '2026-10-26', resets_at: '2026-10-27T00:00:00Z',
    analyses: { used: 3, limit: 20, remaining: 17 },
    capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 },
    concurrency: { active: 0, limit: 1 },
    per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true,
  } });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
try {
  const response = await page.goto(origin);
  assert.equal(response.status(), 200);
  assert.doesNotMatch(response.headers()['x-robots-tag'] || '', /noindex/i);
  assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers()['x-frame-options'], 'DENY');
  const html = await response.text();
  assert.match(html, /Scrape it/);
  assert.match(html, /Frequently asked/);
  assert.equal(await page.locator('.faq details').count(),10);
  assert.equal(await page.getByRole('link',{name:'View all designs',exact:true}).count(),1);
  assert.equal(await page.locator('.hero-demo,.motion-controls,.access-options,.mix-ratio').count(),0);
  assert.doesNotMatch((await page.locator('a,button').allTextContents()).join(' '),/[↗↓←→]/);
  assert.doesNotMatch(html, /<div id="root"><\/div>|Open demo|\/demo\//);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('#hero-replay,#hero-motion,#mix-replay,#mix-motion').count(),0);
  assert.doesNotMatch(await page.locator('main').innerText(),/[—–-]/);
  assert.equal(await page.locator('#evidence-title br').count(),0);
  assert.equal(await page.locator('.export-list > div').count(),5);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), canonical);
  assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  assert.equal(new URL(image).origin, new URL(canonical).origin);
  assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute('content'), image);
  const socialResponse = await context.request.get(`${origin}${new URL(image).pathname}`);
  assert.equal(socialResponse.status(), 200);
  assert.match(socialResponse.headers()['content-type'], /image\/jpeg/);
  const dimensions = await page.evaluate(async path => { const image = new Image(); image.src = path; await image.decode(); return [image.naturalWidth,image.naturalHeight]; }, new URL(image).pathname);
  assert.deepEqual(dimensions, [1185,622]);
  assert.equal(await page.locator('meta[property="og:image:width"]').getAttribute('content'), String(dimensions[0]));
  assert.equal(await page.locator('meta[property="og:image:height"]').getAttribute('content'), String(dimensions[1]));
  checks.push('Static HTML, one H1, canonical/OG/Twitter and actual social image dimensions agree');

  const robots = await context.request.get(`${origin}/robots.txt`);
  assert.match(robots.headers()['content-type'], /text\/plain/);
  assert.match(await robots.text(), /Sitemap: https:\/\/design-scraper.pages.dev\/sitemap.xml/);
  assert.doesNotMatch(await robots.text(), /Disallow:\s*\//);
  const sitemap = await context.request.get(`${origin}/sitemap.xml`);
  assert.match(sitemap.headers()['content-type'], /xml/);
  assert.deepEqual([...((await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g))].map(m => m[1]), [canonical]);
  for (const route of ['/app/', '/demo/']) {
    const app = await context.request.get(`${origin}${route}`);
    assert.equal(app.status(),200);
    assert.match(app.headers()['x-robots-tag'], /noindex, nofollow, noarchive/);
    assert.match(await app.text(), /name="robots" content="noindex, nofollow, noarchive"/);
    assert.doesNotMatch(await app.text(), /rel="canonical"/);
  }
  const missing = await context.request.get(`${origin}/not-a-real-page`);
  assert.equal(missing.status(),404);
  assert.match(await missing.text(), /name="robots" content="noindex/);
  checks.push('Real robots/sitemap, indexable root, noindex application and legacy bridge, real 404');

  const stripe = JSON.parse(await readFile('../frontend/src/examples/stripe.json','utf8'));
  const mix = JSON.parse(await readFile('../frontend/src/examples/bootstrap-milligram.json','utf8'));
  assert.equal(stripe.design_system.typography.scale[0].size.value,'48px');
  assert.match(await page.locator('.evidence-ledger').innerText(), /48px \/ 300/);
  assert.match(await page.locator('.evidence-ledger').innerText(), /#533AFD.*Inferred/s);
  assert.deepEqual(mix.metadata.weights,{web_1:25,web_2:75});
  assert.match(await page.locator('#hero-provenance').innerText(), /illustrative 3D extraction.*does not run a live analysis/s);
  checks.push('Evidence statuses, historical dates and mix weights agree with saved material');

  const widths = [320,360,390,429,430,431,640,759,760,761,768,1024,1049,1050,1051,1099,1100,1101,1265,1440,1800,1920];
  for (const width of widths) {
    await page.setViewportSize({width,height:width<=430?844:900});
    await page.waitForTimeout(160); // The responsive motion layout is debounced by 100ms.
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scene:document.querySelector('.hero-art').getBoundingClientRect().width}));
    assert.ok(layout.scrollWidth <= width + 1, `No page overflow at ${width}px: ${layout.scrollWidth}`);
    const aligned=await page.evaluate(()=>['.product-header','#hero-title','#what-you-get'].map(selector=>document.querySelector(selector).getBoundingClientRect().x));
    assert.ok(Math.max(...aligned)-Math.min(...aligned)<2,'Header, hero and content share a gutter');
    layouts.push(layout);
    if ([390,768,1265].includes(width)) {
      for (const image of await page.locator('img').all()) await image.scrollIntoViewIfNeeded();
      await page.evaluate(async () => {await Promise.all([...document.images].map(image=>image.decode()));window.scrollTo(0,0);});
      await page.screenshot({path:`${artifacts}/landing-${width}.png`,fullPage:true});
      await page.screenshot({path:`${artifacts}/hero-${width}.png`});
    }
  }
  await page.setViewportSize({width:1265,height:712});
  await page.goto(origin);
  const action = await page.locator('.hero .primary').boundingBox();
  assert.ok(action.y+action.height<712,'Primary action in first desktop frame');
  assert.equal(await page.locator('.hero button').count(),0);
  await page.waitForFunction(()=>document.querySelector('#hero-scene').dataset.ready==='true');
  assert.deepEqual(await page.locator('.exports-heading,.export-list > div').evaluateAll(items=>items.map(item=>item.dataset.reveal)),Array(6).fill('still'));
  assert.equal(await page.locator('.hero').getAttribute('data-phase'),'resolution');
  assert.ok(Number(await page.locator('#hero-scene').getAttribute('data-meshes'))>50);
  assert.equal(await page.locator('.line-hot .headline-glyph').first().evaluate(el=>getComputedStyle(el).opacity),'1');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'main-content');
  await page.locator('.faq summary').filter({hasText:'Which websites can I analyze, and what limits apply?'}).click();
  assert.equal(await page.locator('details').filter({hasText:'Which websites can I analyze'}).getAttribute('open'),'');
  checks.push('Responsive boundaries; keyboard skip link, native disclosure and reduced-motion result');

  const noJs = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  await isolateReplayNetwork(noJs,origin);
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin);
  assert.equal(await staticPage.getByRole('heading',{level:1}).isVisible(),true);
  assert.equal(await staticPage.locator('.hero .primary').getAttribute('href'),'/app/#/analyze/start');
  assert.equal(await staticPage.locator('.scene-fallback').isVisible(),true);
  assert.equal(await staticPage.locator('#hero-motion').isVisible(),false);
  await staticPage.locator('.faq summary').filter({hasText:'What are saved designs?'}).click();
  assert.match(await staticPage.locator('.faq').innerText(),/rather than official brand guides/);
  assert.ok(await staticPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await noJs.close();
  checks.push('Static content, evidence and navigation survive disabled JavaScript');

  const unavailable=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await isolateReplayNetwork(unavailable,origin);
  await unavailable.route('**/fonts/landing/*.typeface.json',route=>route.fulfill({status:503,body:'Unavailable'}));
  const fallback=await unavailable.newPage();
  await fallback.goto(origin);
  await fallback.locator('#hero-error').waitFor({state:'visible'});
  assert.equal(await fallback.locator('.scene-fallback').isVisible(),true);
  assert.equal(await fallback.locator('.line-hot').innerText(),'hot.');
  assert.equal(await fallback.locator('#hero-motion').isVisible(),false);
  assert.equal(await fallback.locator('.hero .primary').getAttribute('href'),'/app/#/analyze/start');
  await fallback.getByRole('link',{name:'Meet Mix It',exact:true}).click();
  await fallback.locator('#mix-error').waitFor({state:'visible'});
  assert.equal(await fallback.locator('#mix-action').isVisible(),true);
  await unavailable.close();
  checks.push('Unavailable 3D assets retain readable headlines, hero fallback and working app entry links');

  await page.goto(origin);
  await page.getByRole('link',{name:'Inspect the Stripe result'}).click();
  const preview=page.locator('#saved-design-preview');
  await preview.getByRole('button',{name:'Export design',exact:true}).waitFor();
  assert.match(page.url(),/\/app\/#\/library\/stripe$/);
  await page.reload();
  await preview.getByRole('button',{name:'Export design',exact:true}).waitFor();
  await preview.getByRole('button',{name:'Export design',exact:true}).click();
  await preview.getByRole('tab',{name:'CSS Variables',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await preview.getByRole('button',{name:/^Download/}).click();
  const download=await downloadPromise;
  assert.equal(await readFile(await download.path(),'utf8'),stripe.exports.css_variables);
  await preview.getByRole('button',{name:'Close export',exact:true}).click();
  await preview.getByRole('link',{name:/Back to library/}).click();
  await page.waitForURL('**/#/library');
  await page.waitForFunction(()=>document.activeElement.id==='open-stripe');
  await page.goBack();
  await preview.getByRole('button',{name:'Export design',exact:true}).waitFor();
  await page.goForward();
  await page.waitForURL('**/#/library');
  checks.push('Landing → saved Stripe → reload → exact CSS download; close and history preserve the result');

  assert.deepEqual(apiRequests, [], 'Landing and saved designs do not request the API');
  for (const prefix of ['/', '/demo/']) for (const hash of ['#/analyze','#/library','#/activity','#/library/stripe']) {
    await page.goto(`${origin}${prefix}${hash}`);
    await page.waitForURL(`${origin}/app/${hash}`);
  }
  await page.goto(`${origin}/app/#/library/not-present`);
  await page.getByRole('alert').filter({hasText:'This saved design was not found'}).waitFor();
  await page.getByRole('link',{name:'View Milligram design',exact:true}).click();
  await preview.getByRole('button',{name:'Export design',exact:true}).waitFor();
  checks.push('Root hash and legacy /demo/ links preserve all sections; unknown example recovers in the library');
  for (const href of ['/app/#/library/github','/app/#/library/milligram','/app/#/library/bootstrap-milligram','/app/#/library/example-domain','/app/#/analyze/start','/app/#/library']) {
    await page.goto(origin);
    await page.locator(`a[href="${href}"]`).first().click();
    if(href.includes('/library/')) await preview.getByRole('button',{name:'Export design',exact:true}).waitFor();
    else if(href.includes('/analyze')) await page.getByRole('heading',{name:'One URL. The whole system.'}).waitFor();
    else await page.getByRole('heading',{name:'Design library',exact:true}).waitFor();
  }
  checks.push('Every promoted result and application destination opens without an analysis');

  // Run complete narratives and record them; choreography still requires visual review.
  for(const [name,width,height] of [['desktop',1265,712],['mobile',390,844]]) {
    const ctx=await browser.newContext({viewport:{width,height},reducedMotion:'no-preference',recordVideo:{dir:`${artifacts}/recordings`,size:{width,height}},serviceWorkers:'block'});
    const network=await isolateReplayNetwork(ctx,origin), mp=await ctx.newPage();
    mp.on('pageerror',e=>{errors.push(e.message);console.error('Landing runtime error:',e.message)});
    await mp.goto(origin);
    await mp.waitForFunction(()=>document.querySelector('#hero-scene').dataset.ready==='true');
    assert.equal(await mp.locator('#hero-scene canvas').count(),1);
    assert.equal(await mp.locator('.brand-iron').count(),1);
    await mp.waitForFunction(()=>document.querySelector('.hero').dataset.brandPhase==='contact',{},{timeout:15000});
    assert.equal(await mp.locator('.hero button,#mix-it button').count(),0,'Both scenes use viewport playback without buttons');
    await mp.locator('#examples').scrollIntoViewIfNeeded();
    await mp.waitForFunction(()=>document.querySelector('.hero').dataset.playback==='paused');
    const frozen=await mp.locator('#hero-scene').getAttribute('data-time');
    await mp.waitForTimeout(250);
    assert.equal(await mp.locator('#hero-scene').getAttribute('data-time'),frozen);
    assert.equal(await mp.locator('.line-hot .headline-glyph').first().evaluate(el=>getComputedStyle(el).color),'rgb(227, 41, 46)');
    await mp.locator('.hero').scrollIntoViewIfNeeded();
    await mp.waitForFunction(()=>document.querySelector('.hero').dataset.playback==='playing');
    await mp.waitForFunction(()=>document.querySelector('.hero').dataset.playback==='complete',{},{timeout:15000});
    assert.equal(await mp.locator('.line-hot .headline-glyph').first().evaluate(el=>getComputedStyle(el).color),'rgb(25, 26, 23)');
    await mp.screenshot({path:`${artifacts}/hero-approved-${name}.png`});
    await mp.locator('#examples').scrollIntoViewIfNeeded();
    await mp.locator('.hero').scrollIntoViewIfNeeded();
    await mp.waitForFunction(()=>Number(document.querySelector('.hero').dataset.cycle)>0);
    await mp.locator('.exports-heading').scrollIntoViewIfNeeded();
    for(const item of await mp.locator('.exports-heading,.export-list > div').all()) {
      await item.scrollIntoViewIfNeeded();
      await mp.waitForFunction(node=>node.dataset.reveal==='visible',await item.elementHandle());
      assert.equal(await item.locator('> :first-child').evaluate(el=>getComputedStyle(el).clipPath),'none');
    }
    await mp.screenshot({path:`${artifacts}/exports-revealed-${name}.png`});
    await mp.locator('#mix-it').scrollIntoViewIfNeeded();
    assert.ok(['paused','complete'].includes(await mp.locator('.hero').getAttribute('data-playback')));
    await mp.waitForFunction(()=>document.querySelector('#mix-scene').dataset.ready==='true');
    assert.equal(await mp.locator('#mix-scene canvas').count(),1);
    assert.ok(Number(await mp.locator('#mix-scene').getAttribute('data-meshes'))>300);
    await mp.waitForFunction(()=>Number(document.querySelector('#mix-it').dataset.inkMarks)>4,{},{timeout:10000});
    await mp.locator('#faq').scrollIntoViewIfNeeded();
    await mp.waitForFunction(()=>document.querySelector('#mix-it').dataset.playback==='paused');
    const token=await mp.locator('#mix-scene').getAttribute('data-time');
    const paint=await mp.locator('.mix-ink-air').innerHTML();
    const marks=Number(await mp.locator('#mix-it').getAttribute('data-ink-marks'));
    await mp.waitForTimeout(250);
    assert.equal(await mp.locator('#mix-scene').getAttribute('data-time'),token);
    assert.equal(await mp.locator('.mix-ink-air').innerHTML(),paint);
    assert.ok(Number(await mp.locator('#mix-it').getAttribute('data-ink-letters'))>0);
    assert.ok(Number(await mp.locator('#mix-it').getAttribute('data-ink-background'))>0);
    await mp.locator('#mix-it').scrollIntoViewIfNeeded();
    await mp.waitForFunction(()=>document.querySelector('#mix-it').dataset.playback==='playing');
    await mp.waitForFunction(()=>Number(document.querySelector('#mix-it').dataset.cycle)>0,{},{timeout:15000});
    assert.ok(Number(await mp.locator('#mix-it').getAttribute('data-ink-marks'))>=marks,'Paint survives the continuous-loop boundary');
    await mp.screenshot({path:`${artifacts}/mix-banner-${name}.png`});
    assert.equal(await mp.locator('#mix-it button').count(),0,'Scroll controls the decorative loop');
    await mp.emulateMedia({reducedMotion:'reduce'});
    await mp.waitForFunction(()=>document.querySelector('#mix-it').dataset.playback==='still').catch(async error=>{console.error(JSON.stringify({name,errors,media:await mp.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),state:await mp.locator('#mix-it').getAttribute('data-playback')}));throw error});
    assert.equal(await mp.locator('#mix-it').getAttribute('data-playback'),'still');
    assert.deepEqual(await mp.locator('.exports-heading,.export-list > div').evaluateAll(items=>items.map(item=>item.dataset.reveal)),Array(6).fill('still'));
    await mp.emulateMedia({reducedMotion:'no-preference'});
    await mp.waitForFunction(()=>document.querySelector('#mix-it').dataset.playback==='playing');
    // Both action links remain reachable while decorative geometry crosses them.
    assert.equal(await mp.locator('#mix-action').getAttribute('href'),'/app/#/analyze/mix');
    assert.deepEqual(network,[]);
    const video=mp.video(); await ctx.close(); await video.saveAs(`${artifacts}/hero-mix-${name}.webm`);
  }
  checks.push('Real WebGL hero and continuous blender on desktop/mobile; iron red-to-ink closure, viewport pause/resume and hero reentry, sequential export reveal, persistent letter/background paint and live reduced-motion changes; videos saved');
  assert.ok(quotaReads > 0, 'Activity loads its mocked public capacity counter');
  assert.ok(apiRequests.every(url => new URL(url).pathname === '/api/quotas'));
  assert.equal(apiRequests.length, quotaReads);
  assert.deepEqual(unexpected,[]);
  assert.deepEqual(errors,[]);
  await writeFile(`${artifacts}/report.json`,JSON.stringify({status:'pass',checks,layouts,analysisRequests:0,mockedQuotaReads:quotaReads,unexpectedNetwork:[],errors,temporalVisualReview:'Requires watching the recordings; tests do not approve choreography'},null,2));
  console.log(JSON.stringify({status:'pass',checks,analysisRequests:0,mockedQuotaReads:quotaReads},null,2));
} finally {await browser.close();}
