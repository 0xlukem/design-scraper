import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { PublicResources } from "../src/public-resources";
import { capture } from "../src/capture";
import { config } from "../src/config";
import { ApiError } from "../src/errors";
import type { NetworkPolicy } from "../src/url-safety";
import { extractionScript } from "../src/domain/extraction-script";
import { captureReadiness } from "../src/capture-readiness";
let browser: Browser;
let site: Server, cdn: Server;
let origin: string, assets: string;
let failImage = false;
let navigationAbort: AbortController | undefined;
const fetched = new Set<string>();
const font = readFileSync(
  new URL(
    "../../frontend/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
    import.meta.url,
  ),
);
const listen = (s: Server) =>
  new Promise<string>((resolve) =>
    s.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    ),
  );
beforeAll(async () => {
  cdn = createServer((req, res) => {
    fetched.add(req.url || "");
    res.setHeader("access-control-allow-origin", "*");
    if (req.url?.startsWith("/background-status/")) {
      res.statusCode = Number(req.url.split("/")[2]?.split("?")[0]);
      res.setHeader("content-type", "application/xml");
      res.end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    if (req.url === "/design.css") {
      res.setHeader("content-type", "text/css");
      res.end(
        `@font-face{font-family:FixtureGeist;src:url('${assets}/font.woff2')} :root{--external-brand:#123456;--external-space:24px} body{font-family:FixtureGeist;color:rgb(18,52,86)}.card{padding:24px;border-radius:12px;background:#edf1f5}@media(min-width:700px){.card{max-width:800px}}`,
      );
    } else if (req.url === "/font.woff2") {
      res.setHeader("content-type", "font/woff2");
      res.end(font);
    } else {
      if (failImage || req.url === "/missing.svg") {
        res.statusCode = 404;
        res.end();
      } else {
        res.setHeader("content-type", "image/svg+xml");
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#abc"/></svg>',
        );
      }
    }
  });
  assets = (await listen(cdn)).replace("127.0.0.1", "localhost");
  site = createServer((req, res) => {
    if (req.url?.startsWith("/script-quality/")) {
      const mode = req.url.split("/")[2];
      const scriptUrl = mode === "unsafe" ? "http://127.0.0.1:1/private.js" : mode === "redirect"
        ? "/script-redirect" : mode === "network" || mode === "blocking-network" ? "/script-network-failure" : "/script-unavailable?token=never-record-this";
      const attribute = mode === "blocking" || mode === "blocking-network" ? "" : mode === "defer" ? "defer" : mode === "module" ? 'async type="module"' : "async";
      const content = mode === "bootstrap" ? '<div id="app"><h1>Loading application</h1></div>' :
        `<main ${mode === "busy" ? 'aria-busy="true"' : ""}><h1>Rendered reference website</h1><p>This reference contains useful typography, colors and complete introductory copy already rendered by the source server.</p><a href="#details">Explore the details</a></main>`;
      res.setHeader("content-type", "text/html");
      res.end(`<html><head>${mode === "unstyled" ? "" : '<style>:root{--fixture-brand:#563cff}body{font-family:Arial;color:#563cff}main{padding:40px;background:#eaf0ff;border-radius:12px}</style>'}<script ${attribute} src="${scriptUrl}"></script>${mode === "shared-blocking" ? `<script src="${scriptUrl}"></script>` : ""}</head><body>${content}</body></html>`);
      return;
    }
    if (req.url === "/script-redirect") {
      res.writeHead(302, { location: `${origin}/script-unavailable?token=never-record-this` }); res.end(); return;
    }
    if (req.url === "/script-network-failure") { req.socket.destroy(); return; }
    if (req.url?.startsWith("/script-unavailable")) {
      res.writeHead(404, { "content-type": "text/javascript" }); res.end(); return;
    }
    if (req.url === "/speculative") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><link rel="prefetch" href="/future-page"></head><body><h1>Before data</h1><script>
        fetch('/future-data',{headers:{'next-router-prefetch':'1'}}).catch(()=>{});
        fetch('/required-data').then(r=>r.text()).then(text=>document.querySelector('h1').textContent=text);
      </script></body></html>`);
      return;
    }
    if (["/future-page", "/future-data", "/required-data"].includes(req.url || "")) {
      fetched.add(req.url!);
      res.setHeader("content-type", "text/plain");
      res.end(req.url === "/required-data" ? "Required application data" : "Speculative data");
      return;
    }
    if (req.url === "/font-after-background") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><h1>Hydrated font fixture</h1><div id="bg" style="width:400px;height:300px"></div><script>
        addEventListener('load',()=>setTimeout(()=>{
          const img=new Image();
          img.onload=()=>{
            const style=document.createElement('style');
            style.textContent="@font-face{font-family:LateFont;src:url('/delayed-font.woff2')}h1{font-family:LateFont}";
            document.head.append(style);
          };
          img.src='/delayed-background.svg';
          document.querySelector('#bg').style.backgroundImage="url('/delayed-background.svg')";
        },100));
      </script></body></html>`);
      return;
    }
    if (req.url === "/delayed-background.svg") {
      setTimeout(() => {
        res.setHeader("content-type", "image/svg+xml");
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#123456"/></svg>');
      }, 1800);
      return;
    }
    if (req.url === "/delayed-font.woff2") {
      setTimeout(() => {
        res.setHeader("content-type", "font/woff2");
        res.end(font);
      }, 700);
      return;
    }
    if (req.url?.startsWith("/background-policy/")) {
      const mode = req.url.split("/")[2];
      const status = ["403", "500"].includes(mode || "") ? mode : "404";
      const image = mode === "unsafe" ? "http://127.0.0.1:1/private.png" : `${assets}/background-status/${status}?credential=do-not-record`;
      res.setHeader("content-type", "text/html");
      res.end(`<html><style>body{margin:0}#bg{width:400px;height:300px;background-color:rgb(12,34,56);background-image:url('${image}'),linear-gradient(rgb(50,150,100),rgb(50,150,100))}#bg::before{content:'';display:block;width:30px;height:30px;background-image:url('${image}')}</style><body><div id="bg"></div>${mode === "shared-img" ? `<img src="${image}" width="80" height="80">` : ''}</body></html>`);
      return;
    }
    if (req.url === "/http-error-redirect") {
      res.writeHead(302, { location: `${origin}/http-error?token=private-query-value` });
      res.end();
      return;
    }
    if (req.url?.startsWith("/http-error")) {
      res.writeHead(429, { "content-type": "text/html" });
      res.end("<html><body>private-response-body</body></html>");
      return;
    }
    if (req.url === "/region" || req.url === "/visible-missing") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><style>body{margin:0;min-height:9000px;color:#123456} .off{position:absolute;top:8000px;color:rgb(255,0,255)}</style></head><body><h1>Region fixture</h1><img loading="lazy" class="${req.url === "/region" ? "off" : ""}" src="${assets}/missing.svg" width="120" height="80"><div class="off">Outside color</div></body></html>`);
      return;
    }
    if (req.url === "/smooth-scroll") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><style>html{scroll-behavior:smooth}body{margin:0;height:7000px}#lazy{position:absolute;top:3500px}</style></head><body><h1>Smooth scroll fixture</h1><img id="lazy" loading="lazy" src="${assets}/smooth-lazy.svg" width="120" height="80"><script>window.maxScrollY=0;addEventListener('scroll',()=>window.maxScrollY=Math.max(window.maxScrollY,scrollY))</script></body></html>`);
      return;
    }
    if (req.url === "/late-background") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><h1>Late background fixture</h1><div id="bg" style="width:400px;height:300px"></div><script>setTimeout(()=>document.querySelector('#bg').style.backgroundImage='url(${origin}/slow-resource)',300)</script></body></html>`);
      return;
    }
    if (req.url === "/clipped") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><h1>Clipped carousel fixture</h1><div style="width:100px;height:100px;overflow:hidden"><img style="margin-left:300px" loading="lazy" src="${assets}/missing.svg" width="80" height="80"></div><div style="opacity:0"><img loading="lazy" src="${assets}/missing.svg" width="80" height="80"></div></body></html>`);
      return;
    }
    if (req.url === "/large-css") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><style>${".unused{padding:1px}\n".repeat(28000)}:root{--large-sheet-token:#125678} body{color:#125678}</style></head><body><h1>Large stylesheet fixture</h1></body></html>`);
      return;
    }
    if (req.url === "/fatal-and-slow") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><link rel="stylesheet" href="http://127.0.0.1:1/private.css"></head><body><img src="${origin}/slow-resource"></body></html>`);
      return;
    }
    if (req.url === "/slow-resource") return;
    if (req.url === "/dynamic") {
      res.setHeader("content-type", "text/html");
      res.end(`<html><head><style>:root{--retained-token:#123456}</style><style id="removed">:root{--removed-token:#abcdef}</style><script>setTimeout(()=>document.getElementById("removed").remove(),30)</script></head><body><h1>Dynamic stylesheet</h1></body></html>`);
      return;
    }
    if (req.url === "/redirect" || req.url === "/unsafe-redirect") {
      res.writeHead(302, { location: req.url === "/redirect" ? `${origin}/` : "http://127.0.0.1:1/private" });
      res.end();
      return;
    }
    if (req.url === "/slow") {
      navigationAbort?.abort();
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head>${req.url === "/long" ? "<style>body{min-height:5000px}</style>" : ""}<title>External resources fixture</title><link rel="stylesheet" href="${assets}/design.css"></head><body><article class="card"><h1>Real external font</h1><img src="${assets}/image.svg" width="120" height="80"><button>Action</button></article></body></html>`,
    );
  });
  origin = await listen(site);
});
beforeEach(async () => {
  browser = await chromium.launch({ headless: true });
});
afterEach(async () => {
  await browser?.close();
});
afterAll(async () => {
  await browser?.close();
  await Promise.all(
    [site, cdn]
      .filter(Boolean)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
// Explicit injected test-only transport policy for loopback fixture servers. No env switch can disable production validation.
// The Cloudflare fork adds sessionId and different event overloads. This adapter is test-only;
// capture uses the common Chromium methods, all exercised below against a real browser.
const captureBrowser = () =>
  browser as unknown as import("@cloudflare/playwright").Browser;
const policy: NetworkPolicy = {
  async validate(url) {
    if (!url.startsWith(origin) && !url.startsWith(assets))
      throw new ApiError("UNSAFE_URL", "Unexpected fixture destination.", 422);
  },
  audit() {},
};
it('checks lazy images when their viewport is photographed and still rejects a broken visible image', async () => {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await page.setContent('<style>body{margin:0;height:4000px}img{position:absolute;top:3000px;width:120px;height:80px}</style><img src="data:image/png;base64,broken">');
    const inspect = () => page.evaluate(`(${captureReadiness})({height:4000,waitMs:0,viewportOnly:true})`) as Promise<{pending:number;outside:number;imageUrls:string[]}>;
    expect(await inspect()).toMatchObject({pending:0,outside:0,imageUrls:[]});
    await page.evaluate(() => scrollTo(0,2800));
    expect((await inspect()).pending).toBe(1);
    await page.locator('img').evaluate((img: HTMLImageElement) => { img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>'); });
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    expect((await inspect()).pending).toBe(0);
  } finally { await page.close(); }
});
it("loads cross-host CSS, font and image, extracts exact styles, and closes the context", async () => {
  const r = await capture(
    captureBrowser(),
    origin,
    config({}),
    AbortSignal.timeout(15000),
    policy,
  );
  expect(fetched).toEqual(
    new Set(["/design.css", "/font.woff2", "/image.svg"]),
  );
  expect(r.data.cssVariables).toMatchObject({
    "--external-brand": "#123456",
    "--external-space": "24px",
  });
  expect(r.data.colors).toContainEqual(
    expect.objectContaining({ color: "rgb(18, 52, 86)" }),
  );
  expect(r.data.fonts).toContainEqual(
    expect.objectContaining({ font: "FixtureGeist" }),
  );
  expect(r.data.breakpoints).toContain("(min-width: 700px)");
  expect(r.data.capture).toMatchObject({ fonts_loaded: true });
  expect(r.data.measurements).toMatchObject({version:1,samples:expect.arrayContaining([
    expect.objectContaining({kind:'heading',styles:expect.objectContaining({fontFamily:'FixtureGeist'})}),
    expect.objectContaining({kind:'card',styles:expect.objectContaining({paddingTop:'24px',borderRadius:'12px'})}),
  ])});
  expect(r.metrics.external_hosts).toBe(2);
  expect(Buffer.from(r.screenshot, "base64").subarray(0, 3)).toEqual(
    Buffer.from([255, 216, 255]),
  );
  expect(browser.contexts()).toHaveLength(0);
});
it('samples distinct visible element kinds instead of filling the budget with repeated early controls', async () => {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent(`<style>body{margin:0}button{font:400 14px Arial;padding:12px 0;border-radius:4px}h1{font:300 26px/31.2px Arial;letter-spacing:-.52px}.cta{background:rgb(83,58,253);padding:8px 24px}.card{padding:20px}</style>
    <nav>${Array.from({length:25},(_,i)=>`<button>Navigation ${'x'.repeat(i)}</button>`).join('')}</nav>
    <h1>Measured heading</h1>${Array.from({length:7},(_,i)=>`<h1 style="color:rgb(${i},0,0)">Heading variant</h1>`).join('')}<h3 style="font-size:18px">Late card title</h3><p>Body copy</p><article class="card">Card</article><a href="#" role="button" class="cta">Start</a>
    <h1 style="display:none;font-size:111px">Hidden heading</h1><input aria-label="Email"><footer style="position:absolute;top:5000px">Outside capture</footer>`);
  const result=await page.evaluate(`(${extractionScript})({maxElements:3000,maxHeight:4000,skipStylesheets:true})`) as {measurements:{samples:{kind:string;selector:string;styles:Record<string,string>}[];candidateCounts:Record<string,number>}};
  const samples=result.measurements.samples;
  expect(samples.length).toBeLessThanOrEqual(24);
  expect(result.measurements.candidateCounts.button).toBe(26);
  expect(samples.filter(s=>s.kind==='button')).toHaveLength(2);
  expect(samples.find(s=>s.kind==='heading')?.styles).toMatchObject({fontSize:'26px',fontWeight:'300',lineHeight:'31.2px',letterSpacing:'-0.52px'});
  expect(samples.some(s=>s.kind==='heading' && s.styles.fontSize==='18px')).toBe(true);
  expect(samples.map(s=>s.kind)).toEqual(expect.arrayContaining(['heading','body','button','card','input','navigation']));
  expect(samples.some(s=>s.kind==='footer'||s.styles.fontSize==='111px')).toBe(false);
  for(const sample of samples)expect(await page.locator(sample.selector).count()).toBe(1);
  await page.close();
});
it("rejects incomplete external visual assets instead of generating a misleading capture", async () => {
  failImage = true;
  try {
    await expect(
      capture(
        captureBrowser(),
        origin,
        config({}),
        AbortSignal.timeout(15000),
        policy,
      ),
    ).rejects.toMatchObject({ code: "CAPTURE_INCOMPLETE" });
  } finally {
    failImage = false;
  }
  expect(browser.contexts()).toHaveLength(0);
});
it.each([1, 20, 40, 80])("closes the context when the deadline expires after %i ms", async (delay) => {
  await expect(
    capture(
      captureBrowser(),
      origin,
      config({}),
      AbortSignal.timeout(delay),
      policy,
    ),
  ).rejects.toMatchObject({ code: "SCRAPE_TIMEOUT" });
  expect(browser.contexts()).toHaveLength(0);
});
it("enforces network request limits and blocks unapproved external destinations", async () => {
  await expect(
    capture(
      captureBrowser(),
      origin,
      config({ MAX_NETWORK_REQUESTS: "1" }),
      AbortSignal.timeout(10000),
      policy,
    ),
  ).rejects.toMatchObject({ code: "SCRAPE_REQUEST_LIMIT" });
});

it("cancels an in-flight navigation and closes the owned browser", async () => {
  navigationAbort = new AbortController();
  await expect(
    capture(
      captureBrowser(),
      `${origin}/slow`,
      config({}),
      navigationAbort.signal,
      policy,
    ),
  ).rejects.toMatchObject({ code: "SCRAPE_TIMEOUT" });
  expect(browser.contexts()).toHaveLength(0);
});
it("cleans up when cancellation happened before context acquisition", async () => {
  await expect(
    capture(captureBrowser(), origin, config({}), AbortSignal.abort(), policy),
  ).rejects.toMatchObject({ code: "SCRAPE_TIMEOUT" });
  expect(browser.contexts()).toHaveLength(0);
});

it("preserves external styles and font through the public-resource transport", async () => {
  const signal = AbortSignal.timeout(15000);
  const r = await capture(
    captureBrowser(),
    origin,
    config({}),
    signal,
    policy,
    new PublicResources(fetch, signal),
  );
  expect(r.data.cssVariables).toMatchObject({ "--external-brand": "#123456" });
  expect(r.data.fonts).toContainEqual(
    expect.objectContaining({ font: "FixtureGeist" }),
  );
  expect(r.data.capture).toMatchObject({ fonts_loaded: true });
  expect(r.metrics.navigation).toEqual({ response_received: true, status: 200, final_origin: origin });
  expect(r.metrics.routes.started).toBeGreaterThanOrEqual(4);
  expect(r.metrics.routes.completed).toBe(r.metrics.routes.started);
  expect(r.metrics.routes.slowest.length).toBeGreaterThan(0);
  expect(browser.contexts()).toHaveLength(0);
});

it("reports the upstream navigation status without recording paths, query values or response content", async () => {
  const signal = AbortSignal.timeout(15000);
  const error = await capture(captureBrowser(), `${origin}/http-error-redirect`,
    config({}), signal, policy, new PublicResources(fetch, signal)).catch(error => error);
  expect(error).toMatchObject({ code: "SCRAPE_FAILED", message: "The source website returned HTTP 429.",
    captureMetrics: { navigation: { response_received: true, status: 429, final_origin: origin }, close_confirmed: true } });
  expect(JSON.stringify(error.captureMetrics)).not.toMatch(/private-query-value|private-response-body|http-error/);
  expect(browser.contexts()).toHaveLength(0);
});

it("captures beyond the viewport while respecting the 4000px height cap", async () => {
  const r = await capture(captureBrowser(), `${origin}/long`, config({}), AbortSignal.timeout(15000), policy);
  expect(r.data.capture).toMatchObject({ height_truncated: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<img id="capture" src="data:image/jpeg;base64,${r.screenshot}">`);
    const dimensions = await page.evaluate(async () => { const img = document.querySelector('img')!; await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
    expect(dimensions).toEqual([1440, 4000]);
  } finally { await page.context().close(); }
});


it("revalidates public-resource redirects before following each hop", async () => {
  const checked: string[] = [];
  const tracked: NetworkPolicy = { async validate(url) { checked.push(url); await policy.validate(url); }, audit() {} };
  const signal = AbortSignal.timeout(15000);
  const r = await capture(captureBrowser(), `${origin}/redirect`, config({}), signal, tracked, new PublicResources(fetch, signal));
  expect(checked).toContain(`${origin}/redirect`);
  expect(checked).toContain(`${origin}/`);
  expect(r.data.cssVariables).toMatchObject({ "--external-brand": "#123456" });
});
it("blocks redirected destinations before the public transport can fetch them", async () => {
  const fetchedUrls: string[] = [];
  const guarded: typeof fetch = (input, init) => { fetchedUrls.push(String(input)); return fetch(input, init); };
  const signal = AbortSignal.timeout(15000);
  await expect(capture(captureBrowser(), `${origin}/unsafe-redirect`, config({}), signal, policy, new PublicResources(guarded, signal))).rejects.toMatchObject({ code: "UNSAFE_URL" });
  expect(fetchedUrls).not.toContain("http://127.0.0.1:1/private");
});

it("ignores stylesheets explicitly removed by the page while retaining active evidence", async () => {
  const r = await capture(captureBrowser(), `${origin}/dynamic`, config({}), AbortSignal.timeout(15000), policy);
  expect(r.data.cssVariables).toMatchObject({ "--retained-token": "#123456" });
  expect(r.data.cssVariables).not.toHaveProperty("--removed-token");
});


it("ignores only images outside the configured region and scopes computed styles to it", async () => {
  const result = await capture(captureBrowser(), `${origin}/region`, config({ MAX_SCREENSHOT_HEIGHT: "2000" }), AbortSignal.timeout(12000), policy);
  expect(result.metrics.outside_images).toBeGreaterThan(0);
  expect(result.metrics.pending_images).toBe(0);
  expect(result.data.colors).not.toContainEqual(expect.objectContaining({ color: "rgb(255, 0, 255)" }));
  expect(result.data.capture).toMatchObject({ region_height: 2000, height_truncated: true });
});
it("still rejects a broken image inside the captured region", async () => {
  await expect(capture(captureBrowser(), `${origin}/visible-missing`, config({}), AbortSignal.timeout(12000), policy))
    .rejects.toMatchObject({ code: "CAPTURE_INCOMPLETE" });
});
it("triggers lazy images and returns to the top on pages with smooth scrolling", async () => {
  let position: { y: number; max: number } | undefined;
  const adapter = {
    async newContext(options: Parameters<Browser["newContext"]>[0]) {
      const context = await browser.newContext(options);
      const close = context.close.bind(context);
      context.close = async () => {
        position = await context.pages()[0].evaluate(() => ({ y: scrollY, max: (window as unknown as { maxScrollY: number }).maxScrollY }));
        await close();
      };
      return context;
    },
    close: () => browser.close(),
  } as unknown as import("@cloudflare/playwright").Browser;
  const result = await capture(adapter, `${origin}/smooth-scroll`, config({}), AbortSignal.timeout(12000), policy);
  expect(result.metrics.pending_images).toBe(0);
  expect(position).toEqual({ y: 0, max: 3500 });
  expect(fetched.has("/smooth-lazy.svg")).toBe(true);
});
it("selects CSS evidence beyond the former 500k ceiling with source provenance", async () => {
  const result = await capture(captureBrowser(), `${origin}/large-css`, config({}), AbortSignal.timeout(15000), policy);
  expect(result.metrics.css_characters).toBeGreaterThan(500000);
  expect(result.data.cssVariables).toMatchObject({ "--large-sheet-token": "#125678" });
  expect(result.data.cssEvidence).toContainEqual(expect.objectContaining({name: "--large-sheet-token", selector: ":root", stylesheet: `${origin}/large-css`}));
});
it("preserves a fatal safety error and closes promptly while another resource hangs", async () => {
  const started = Date.now();
  const signal = AbortSignal.timeout(10000);
  await expect(capture(captureBrowser(), `${origin}/fatal-and-slow`, config({}), signal, policy, new PublicResources(fetch, signal)))
    .rejects.toMatchObject({ code: "UNSAFE_URL", captureMetrics: expect.objectContaining({ close_confirmed: true }) });
  expect(Date.now() - started).toBeLessThan(4000);
  expect(browser.contexts()).toHaveLength(0);
});

it("does not require images clipped by a carousel ancestor or transparent parent", async () => {
  const result = await capture(captureBrowser(), `${origin}/clipped`, config({}), AbortSignal.timeout(12000), policy);
  expect(result.metrics.pending_images).toBe(0);
  expect(result.metrics.outside_images).toBe(2);
});

it("omits marked speculative navigation downloads while retaining application fetches", async () => {
  fetched.clear();
  const signal = AbortSignal.timeout(12000);
  const result = await capture(captureBrowser(), `${origin}/speculative`, config({}), signal, policy, new PublicResources(fetch, signal));
  expect(result.metrics.blocked.prefetch).toBeGreaterThanOrEqual(1);
  expect(fetched).toContain("/required-data");
  expect(fetched).not.toContain("/future-page");
  expect(fetched).not.toContain("/future-data");
  expect(result.metrics.close_confirmed).toBe(true);
});

it("waits for a font introduced while a visible background finishes loading", async () => {
  const signal = AbortSignal.timeout(12000);
  const result = await capture(captureBrowser(), `${origin}/font-after-background`, config({}), signal, policy, new PublicResources(fetch, signal));
  expect(result.data.capture).toMatchObject({ fonts_loaded: true });
  expect(result.data.fonts).toContainEqual(expect.objectContaining({ font: "LateFont" }));
  expect(result.metrics.close_confirmed).toBe(true);
});

it("rejects a visible background that remains in flight after initial page load", async () => {
  const signal = AbortSignal.timeout(10000);
  await expect(capture(captureBrowser(), `${origin}/late-background`, config({}), signal, policy, new PublicResources(fetch, signal)))
    .rejects.toMatchObject({ code: "CAPTURE_INCOMPLETE" });
});

it("leaves confirmed 404 backgrounds absent, preserves gradients, and records a sanitized gap", async () => {
  const signal = AbortSignal.timeout(12000);
  const result = await capture(captureBrowser(), `${origin}/background-policy/404`, config({}), signal, policy, new PublicResources(fetch, signal));
  expect(result.data.capture).toMatchObject({ missing_background_images_count: 1,
    missing_background_images: [{ url: `${assets}/background-status/404`, status: 404 }] });
  expect(result.metrics.missing_background_images).toBe(1);
  expect(JSON.stringify(result.data.capture)).not.toContain("do-not-record");
  expect(JSON.stringify(result.metrics)).not.toContain("do-not-record");
  const page = await browser.newPage();
  const pixel = await page.evaluate(async screenshot => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + screenshot; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(200, 150, 1, 1).data);
  }, result.screenshot);
  expect(pixel[0]).toBeCloseTo(50, -1);
  expect(pixel[1]).toBeCloseTo(150, -1);
  expect(pixel[2]).toBeCloseTo(100, -1);
  await page.context().close();
});

it.each(["403", "500", "shared-img", "unsafe"])("keeps background exception scoped for %s", async mode => {
  const signal = AbortSignal.timeout(12000);
  await expect(capture(captureBrowser(), `${origin}/background-policy/${mode}`, config({}), signal, policy, new PublicResources(fetch, signal)))
    .rejects.toMatchObject({code: mode === "unsafe" ? "UNSAFE_URL" : "CAPTURE_INCOMPLETE"});
  expect(browser.contexts()).toHaveLength(0);
});

it.each(["http", "network", "redirect"])("retains observed styled content with an explicit async-script gap after a %s failure", async mode => {
  const signal = AbortSignal.timeout(12000);
  const result = await capture(captureBrowser(), `${origin}/script-quality/${mode}`, config({}), signal,
    policy, new PublicResources(fetch, signal));
  expect(result.data.cssVariables).toMatchObject({ "--fixture-brand": "#563cff" });
  expect(result.data.capture).toMatchObject({ failed_async_scripts_count: 1,
    failed_async_scripts: [{ origin, status: mode === "network" ? null : 404 }], blocked_subresources: 0 });
  expect(result.metrics.failed_async_scripts).toBe(1);
  expect(result.metrics.close_confirmed).toBe(true);
  expect(JSON.stringify(result.data.capture)).not.toMatch(/never-record-this|script-unavailable|token=/);
  expect(JSON.stringify(result.metrics)).not.toMatch(/never-record-this|script-unavailable|token=/);
  expect(browser.contexts()).toHaveLength(0);
});

it.each(["blocking", "defer", "module", "shared-blocking", "bootstrap", "busy", "unstyled", "unsafe"])("does not soften failed %s scripts without sufficient observed evidence", async mode => {
  const signal = AbortSignal.timeout(12000);
  await expect(capture(captureBrowser(), `${origin}/script-quality/${mode}`, config({}), signal,
    policy, new PublicResources(fetch, signal))).rejects.toMatchObject({ code: mode === "unsafe" ? "UNSAFE_URL" : "CAPTURE_INCOMPLETE" });
  expect(browser.contexts()).toHaveLength(0);
});

it("applies the same async failure gate to direct Chromium network failures", async () => {
  const result = await capture(captureBrowser(), `${origin}/script-quality/network`, config({}), AbortSignal.timeout(12000), policy);
  expect(result.data.capture).toMatchObject({ failed_async_scripts_count: 1 });
  expect(result.metrics.close_confirmed).toBe(true);
});

it("rejects a failed blocking script on the direct Chromium network path", async () => {
  await expect(capture(captureBrowser(), `${origin}/script-quality/blocking-network`, config({}),
    AbortSignal.timeout(12000), policy)).rejects.toMatchObject({ code: "CAPTURE_INCOMPLETE" });
  expect(browser.contexts()).toHaveLength(0);
});
