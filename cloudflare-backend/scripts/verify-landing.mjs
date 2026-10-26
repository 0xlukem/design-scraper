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
  assert.match(html, /Take the web/);
  assert.match(html, /Your key\./);
  assert.doesNotMatch(html, /<div id="root"><\/div>|Open demo|\/demo\//);
  assert.equal(await page.locator('h1').count(), 1);
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
  assert.match(await page.locator('.mix-ratio').innerText(), /25.*75/s);
  assert.match(await page.locator('#hero-provenance').innerText(), /saved Bootstrap capture.*9 Sep 2026.*No live analysis/s);
  checks.push('Evidence statuses, historical dates and mix weights agree with saved material');

  const widths = [320,360,390,429,430,431,640,759,760,761,768,1024,1049,1050,1051,1099,1100,1101,1265,1440];
  for (const width of widths) {
    await page.setViewportSize({width,height:width<=430?844:900});
    await page.waitForTimeout(160); // The responsive motion layout is debounced by 100ms.
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scene:document.querySelector('.scene').getBoundingClientRect().width}));
    assert.ok(layout.scrollWidth <= width + 1, `No page overflow at ${width}px: ${layout.scrollWidth}`);
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
  assert.equal(await page.locator('#play').isDisabled(),true);
  assert.equal(await page.locator('#scrub').inputValue(),'1000');
  assert.equal(await page.locator('.type-piece').isVisible(),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'main-content');
  await page.getByText('What limits apply to a new analysis?',{exact:true}).click();
  assert.equal(await page.locator('details').filter({hasText:'What limits apply'}).getAttribute('open'),'');
  checks.push('Responsive boundaries; keyboard skip link, native disclosure and reduced-motion result');

  const noJs = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  await isolateReplayNetwork(noJs,origin);
  const staticPage = await noJs.newPage();
  await staticPage.goto(origin);
  assert.equal(await staticPage.getByRole('heading',{level:1}).isVisible(),true);
  assert.equal(await staticPage.locator('.hero .primary').getAttribute('href'),'/app/#/analyze');
  assert.equal(await staticPage.locator('.type-piece').isVisible(),true);
  assert.equal(await staticPage.locator('.motion-controls').isVisible(),false);
  assert.ok(await staticPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await noJs.close();
  checks.push('Static content, evidence and navigation survive disabled JavaScript');

  await page.goto(origin);
  await page.getByRole('link',{name:'Inspect the Stripe result'}).click();
  const preview=page.locator('#saved-design-preview');
  await preview.getByRole('heading',{name:'Design findings'}).waitFor();
  assert.match(page.url(),/\/app\/#\/library\/stripe$/);
  await page.reload();
  await preview.getByRole('heading',{name:'Design findings'}).waitFor();
  await preview.getByRole('tab',{name:'CSS Variables',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await preview.getByRole('button',{name:/^Download/}).click();
  const download=await downloadPromise;
  assert.equal(await readFile(await download.path(),'utf8'),stripe.exports.css_variables);
  await preview.getByRole('button',{name:'Close design',exact:true}).click();
  await page.waitForURL('**/#/library');
  await page.waitForFunction(()=>document.activeElement.id==='open-stripe');
  await page.goBack();
  await preview.getByRole('heading',{name:'Design findings'}).waitFor();
  await page.goForward();
  await page.waitForURL('**/#/library');
  checks.push('Landing → saved Stripe → reload → exact CSS download; close and history preserve the result');

  assert.deepEqual(apiRequests, [], 'Landing and saved designs do not request the API');
  for (const prefix of ['/', '/demo/']) for (const hash of ['#/analyze','#/library','#/activity','#/library/stripe']) {
    await page.goto(`${origin}${prefix}${hash}`);
    await page.waitForURL(`${origin}/app/${hash}`);
  }
  await page.goto(`${origin}/app/#/library/not-present`);
  await page.getByRole('alert').filter({hasText:'That saved design is not in the library'}).waitFor();
  await page.getByRole('button',{name:'View Milligram design',exact:true}).click();
  await preview.getByRole('heading',{name:'Design findings'}).waitFor();
  checks.push('Root hash and legacy /demo/ links preserve all sections; unknown example recovers in the library');
  for (const href of ['/app/#/library/github','/app/#/library/milligram','/app/#/library/bootstrap-milligram','/app/#/library/example-domain','/app/#/analyze','/app/#/activity']) {
    await page.goto(origin);
    await page.locator(`a[href="${href}"]`).first().click();
    if(href.includes('/library/')) await preview.getByRole('heading',{name:'Design findings'}).waitFor();
    else if(href.endsWith('analyze')) await page.getByRole('heading',{name:'One URL. The whole system.'}).waitFor();
    else await page.getByRole('heading',{name:'Activity & costs',exact:true}).waitFor();
  }
  checks.push('Every promoted result and application destination opens without an analysis');

  // Record actual one-shot playback in both compositions; recordings need visual review.
  for(const [name,width,height] of [['desktop',1265,712],['mobile',390,844]]) {
    const motionContext=await browser.newContext({viewport:{width,height},reducedMotion:'no-preference',recordVideo:{dir:`${artifacts}/recordings`,size:{width,height}},serviceWorkers:'block'});
    const motionNetwork=await isolateReplayNetwork(motionContext,origin);
    const motionPage=await motionContext.newPage();
    motionPage.on('pageerror',error=>errors.push(error.message));
    await motionPage.goto(origin);
    await motionPage.waitForFunction(()=>document.querySelector('#scrub').value==='1000' && document.querySelector('#play').getAttribute('aria-label')==='Play animation',{},{timeout:18000});
    assert.equal(await motionPage.locator('#play').getAttribute('aria-label'),'Play animation');
    await motionPage.getByRole('button',{name:'Replay animation',exact:true}).click();
    await motionPage.waitForFunction(()=>Number(document.querySelector('#scrub').value)>30);
    await motionPage.getByRole('button',{name:'Pause animation',exact:true}).click();
    const paused=await motionPage.locator('#scrub').inputValue();
    await motionPage.waitForTimeout(200);
    assert.equal(await motionPage.locator('#scrub').inputValue(),paused);
    await motionPage.locator('#scrub').press('End');
    assert.equal(await motionPage.locator('#scrub').inputValue(),'1000');
    await motionPage.getByRole('button',{name:'01 Site',exact:true}).click();
    assert.equal(await motionPage.locator('.source-window').isVisible(),true);
    await motionPage.getByRole('button',{name:'03 System',exact:true}).click();
    assert.equal(await motionPage.locator('.source-window').isVisible(),false);
    assert.equal(await motionPage.locator('.type-piece').isVisible(),true);
    assert.deepEqual(motionNetwork,[]);
    const video=motionPage.video();
    await motionContext.close();
    await video.saveAs(`${artifacts}/hero-${name}.webm`);
  }
  checks.push('12-second desktop/mobile playback reaches a stable result; replay, pause, keyboard seeking and stages work; videos saved');
  assert.ok(quotaReads > 0, 'Activity loads its mocked public capacity counter');
  assert.ok(apiRequests.every(url => new URL(url).pathname === '/api/quotas'));
  assert.equal(apiRequests.length, quotaReads);
  assert.deepEqual(unexpected,[]);
  assert.deepEqual(errors,[]);
  await writeFile(`${artifacts}/report.json`,JSON.stringify({status:'pass',checks,layouts,analysisRequests:0,mockedQuotaReads:quotaReads,unexpectedNetwork:[],errors,temporalVisualReview:'Requires watching the recordings; tests do not approve choreography'},null,2));
  console.log(JSON.stringify({status:'pass',checks,apiRequests:0},null,2));
} finally {await browser.close();}
