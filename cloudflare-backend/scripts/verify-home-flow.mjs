// Home journeys against the actual Pages build. All API traffic is fulfilled
// locally; the only successful analysis is an unchanged saved response.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolateReplayNetwork } from './replay-network.mjs';
const origin = new URL(process.env.PAGES_URL).origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const artifacts = '../output/playwright/home-ux';
await mkdir(artifacts, { recursive: true });
const sample = JSON.parse(await readFile('../frontend/src/examples/example-domain.json', 'utf8'));
const catalog = JSON.parse(await readFile('../frontend/src/examples/catalog.json', 'utf8'));
const providers = ['gemini','anthropic','openai','xai'].map(provider => ({provider,model:`${provider}-fixture`,inputPrice:provider==='gemini'?0.75:null,outputPrice:provider==='gemini'?4.5:null}));
const quota = {day:'2026-10-26',resets_at:'2026-10-27T00:00:00Z',analyses:{used:3,limit:20,remaining:17},capture:{used_or_reserved_ms:60000,limit_ms:480000,remaining_ms:420000},concurrency:{active:0,limit:1},per_ip:{hourly_limit:3,daily_limit:5},demo_budget_available:true};
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
const unexpected = await isolateReplayNetwork(context, origin);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors=[],checks=[],metrics=[],requests=[];
let ratesMode='success',analysisMode='slow',releaseRates,releaseAnalysis;
page.on('pageerror', e => errors.push(e.message));
await context.route('**/api/**', async route => {
  const req=route.request(), path=new URL(req.url()).pathname;
  requests.push({path,method:req.method()});
  const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers});
  if(path==='/api/quotas') return route.fulfill({headers,json:quota});
  if(path==='/api/providers') {
    if(ratesMode==='slow') await new Promise(resolve => { releaseRates=resolve; });
    if(ratesMode==='error') return route.fulfill({status:503,headers,json:{}});
    return route.fulfill({headers,json:{providers:ratesMode==='empty'?[]:providers}}).catch(()=>{});
  }
  assert.equal(path,'/api/analyze'); assert.equal(req.method(),'POST');
  assert.equal(JSON.parse(req.postData()).url,'https://example.com');
  if(analysisMode==='slow') await new Promise(resolve => {releaseAnalysis=resolve;});
  if(analysisMode==='error') return route.fulfill({status:504,headers,json:{detail:{code:'SCRAPE_TIMEOUT',message:'The source website took too long to load.',retryable:true}}});
  return route.fulfill({headers,json:sample}).catch(()=>{});
});
async function waitForMock(ready) {
  const deadline=Date.now()+5000;
  while(!ready() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(ready(),'Mock request must arrive within five seconds');
}
const analyses=()=>requests.filter(r=>r.method==='POST').length;
try {
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:width<768?844:900});
    await page.goto(origin); await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('.hero-demo').evaluate(e=>e.open),width>760);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const primary=await page.locator('.hero .primary').boundingBox();
    const secondary=await page.locator('.secondary-action').boundingBox();
    assert.ok(primary.y+primary.height<844 && secondary.y+secondary.height<844);
    metrics.push(await page.evaluate(()=>({width:innerWidth,pageHeight:document.documentElement.scrollHeight,examplesY:document.querySelector('#examples').getBoundingClientRect().y,visibleWords:document.body.innerText.split(/\s+/).length})));
    if(width===390) assert.ok(metrics.at(-1).examplesY<600,'References begin before 600px on mobile');
    if([390,1440].includes(width)) {
      await page.screenshot({path:`${artifacts}/after-home-${width}.png`});
      await page.screenshot({path:`${artifacts}/after-full-${width}.png`,fullPage:true});
    }
    await page.locator('.secondary-action').click();
    const first=page.locator('.example-row').first();
    assert.ok((await first.boundingBox()).y<844);
    for(const row of await page.locator('.example-row').all()) {
      const id=(await row.getAttribute('href')).split('/').at(-1);
      assert.deepEqual(await row.locator('.reference-palette i').evaluateAll(items=>items.map(el=>el.style.getPropertyValue('--swatch'))),catalog.find(item=>item.id===id).palette);
      const image=await row.locator('img').boundingBox();
      assert.ok(Math.abs(image.width/image.height-960/504)<0.02,'Cover keeps its original aspect ratio');
    }
    if([390,1440].includes(width)) await page.screenshot({path:`${artifacts}/after-references-${width}.png`});
    await page.goto(origin);
    await page.locator('.hero .primary').click();
    await page.waitForFunction(()=>document.activeElement.id==='single-url');
    const field=await page.locator('#single-url').boundingBox();
    assert.ok(field.y>=0 && field.y+field.height<(width<768?844:900),'Home action focuses a visible URL field');
    assert.equal(await page.getByRole('button',{name:'Analyze design',exact:true}).isDisabled(),true);
    if([390,1440].includes(width)) await page.screenshot({path:`${artifacts}/after-entry-${width}.png`});
  }
  assert.equal(analyses(),0,'Navigation and automatic focus never analyze');
  checks.push('Two visible entry choices at 320/390/768/1440; mobile references before 600px; covers and saved palettes match; task entry focuses URL without submitting');

  await page.setViewportSize({width:390,height:844});
  await page.goto(origin); await page.locator('.hero-demo > summary').click();
  await page.waitForFunction(()=>document.querySelector('.scene').clientHeight>100 && document.querySelector('#scrub').value==='1000');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.hero-demo > summary').click();
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.locator('.hero-demo').evaluate(e=>e.open),false,'Resize preserves explicit collapsed state');
  checks.push('Mobile demonstration opens with valid dimensions and reduced motion; resizing preserves user choice');

  await page.goto(origin);
  ratesMode='slow';
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Models & rates'}).click();
  await page.getByText('Loading models and rates…',{exact:true}).waitFor();
  await page.screenshot({path:`${artifacts}/after-rates-loading.png`});
  await page.waitForFunction(()=>document.querySelector('#rates-status').textContent.includes('Loading'));
  await waitForMock(()=>releaseRates);
  releaseRates();
  await page.getByRole('heading',{name:'Claude / Anthropic',exact:true}).waitFor();
  assert.equal(await page.locator('.rate-item').count(),4);
  assert.equal(await page.locator('#rates-list').getByText('Unavailable',{exact:true}).count(),6);
  assert.equal(await page.locator('input[type=password]').count(),0);
  assert.equal(analyses(),0);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:width<768?844:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('#model-rates').evaluate(el=>el.scrollIntoView({block:'start'}));
    if([390,1440].includes(width)) await page.screenshot({path:`${artifacts}/after-rates-${width}.png`});
  }
  const reads=requests.filter(r=>r.path==='/api/providers').length;
  await page.locator('#model-rates > summary').click();
  await page.getByRole('navigation',{name:'Footer'}).getByRole('link',{name:'Models & rates'}).click();
  assert.equal(await page.locator('#model-rates').evaluate(e=>e.open),true);
  assert.equal(requests.filter(r=>r.path==='/api/providers').length,reads);
  checks.push('Models & rates is independently reachable; four providers, unknown prices remain unavailable, no credentials or analysis; repeated link reopens without refetch');

  for(const mode of ['error','empty']) {
    ratesMode=mode; await page.goto(`${origin}/#model-rates`); await page.reload();
    await page.getByRole('button',{name:'Reload model rates'}).waitFor();
    assert.equal(await page.locator('#rates-list').isVisible(),false);
    await page.screenshot({path:`${artifacts}/after-rates-${mode}.png`});
    ratesMode='success'; await page.getByRole('button',{name:'Reload model rates'}).click();
    await page.getByRole('heading',{name:'Gemini',exact:true}).waitFor();
  }
  checks.push('Failed and empty model catalogs show one recovery action and reload successfully');

  await page.goto(origin);
  await page.locator('.hero .primary').click();
  await page.locator('#single-url').fill('invalid');
  await page.getByRole('button',{name:'Analyze design',exact:true}).click();
  assert.equal(analyses(),0,'Invalid URL is rejected locally');
  await page.locator('#single-url').fill('https://example.com');
  await page.getByRole('button',{name:'Analyze design',exact:true}).click();
  await page.getByRole('button',{name:'Stop waiting',exact:true}).waitFor();
  await page.screenshot({path:`${artifacts}/after-analysis-loading.png`});
  await waitForMock(()=>releaseAnalysis);
  releaseAnalysis();
  await page.getByRole('heading',{name:'Design findings',exact:true}).waitFor();
  assert.equal(analyses(),1);
  analysisMode='error';
  await page.getByRole('button',{name:'Analyze design',exact:true}).click();
  await page.getByRole('button',{name:'Review URL',exact:true}).waitFor();
  await page.getByRole('button',{name:'Review URL',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'single-url');
  assert.equal(await page.locator('#single-url').inputValue(),'https://example.com');
  await page.screenshot({path:`${artifacts}/after-analysis-error.png`,fullPage:true});
  checks.push('Home → focused form → local URL validation → loading → saved response; simulated timeout retains URL and Review URL restores focus');

  for(const id of ['stripe','github','milligram','bootstrap-milligram','example-domain']) {
    const before=analyses();
    await page.goto(origin);
    await page.locator(`a[href="/app/#/library/${id}"]`).first().click();
    await page.locator('#saved-design-preview').getByRole('heading',{name:'Design findings',exact:true}).waitFor();
    assert.equal(analyses(),before);
    await page.goBack();
    await page.locator('#hero-title').waitFor();
  }
  checks.push('All five promoted saved results open and browser Back returns home without analysis');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  await writeFile(`${artifacts}/report.json`,JSON.stringify({checks,metrics,requests,realAnalyses:0,mockedAnalyses:analyses(),errors,unexpected},null,2));
  console.log(JSON.stringify({suite:'home journeys',checks,realAnalyses:0,mockedAnalyses:analyses()},null,2));
} finally {releaseRates?.();releaseAnalysis?.();await browser.close();}
