import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { capture } from "../src/capture";
import { config } from "../src/config";
import { ApiError } from "../src/errors";
import { PublicResources } from "../src/public-resources";
import type { NetworkPolicy } from "../src/url-safety";

let browser: Browser;
let site: Server;
let origin: string;
const fetched = new Set<string>();
const poster = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e63946"/></svg>';

beforeAll(async () => {
  site = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://fixture");
    fetched.add(url.pathname);
    if (url.pathname === "/poster.svg" || url.pathname === "/slow-poster.svg") {
      const send = () => {
        response.writeHead(200, { "content-type": "image/svg+xml" });
        response.end(poster);
      };
      if (url.pathname === "/slow-poster.svg") setTimeout(send, 1200);
      else send();
      return;
    }
    if (url.pathname === "/missing-poster.svg") {
      response.writeHead(404); response.end(); return;
    }
    if (url.pathname === "/application-data") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"title":"Branding fixture"}'); return;
    }
    if (url.pathname === "/opaque-player-source") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.end("excluded video bytes"); return;
    }
    if (url.pathname !== "/") {
      // Video bodies must never reach this server, including broken endpoints.
      response.writeHead(500); response.end("not a playable video"); return;
    }
    const file = url.searchParams.get("file") || "film.webm";
    const posterName = url.searchParams.get("poster") || "poster.svg";
    const posterAttribute = posterName === "none" ? "" : `poster="/${posterName}"`;
    const fetchMedia = url.searchParams.has("fetch")
      ? `<script>fetch('/film.mp4').catch(()=>{});fetch('/opaque-player-source').catch(()=>{});const xhr=new XMLHttpRequest();xhr.open('GET','/segments.m4s');xhr.send();fetch('/application-data').then(r=>r.json()).then(d=>document.querySelector('h1').textContent=d.title);</script>` : "";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><head><style>
      html,body{margin:0;width:100%;height:900px;background:#101820;color:white}
      h1{position:absolute;left:120px;top:60px;margin:0;font:600 48px/56px sans-serif}
      video{position:absolute;left:120px;top:200px;width:320px;height:180px;background:#000;border-radius:12px;object-fit:cover}
    </style></head><body><h1>Branding fixture</h1>
      <video autoplay muted playsinline preload="auto" ${posterAttribute} src="/${file}"></video>${fetchMedia}
    </body></html>`);
  });
  origin = await new Promise<string>(resolve => site.listen(0, "127.0.0.1", () =>
    resolve(`http://127.0.0.1:${(site.address() as {port:number}).port}`)));
});
beforeEach(async () => { fetched.clear(); browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await browser?.close(); });
afterAll(async () => { if(site) await new Promise<void>(resolve => site.close(() => resolve())); });

const captureBrowser = () => browser as unknown as import("@cloudflare/playwright").Browser;
const policy: NetworkPolicy = {
  async validate(url) {
    if (new URL(url).origin !== origin) throw new ApiError("UNSAFE_URL", "Unexpected fixture destination.", 422);
  },
  audit() {},
};
const run = async (query: string) => {
  const signal = AbortSignal.timeout(12000);
  return capture(captureBrowser(), `${origin}/${query}`, config({}), signal, policy, new PublicResources(fetch, signal));
};
const pixel = async (screenshot: string) => {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async encoded => {
      const image = new Image(); image.src=`data:image/jpeg;base64,${encoded}`; await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
      return [...ctx.getImageData(200,280,1,1).data];
    }, screenshot);
  } finally { await page.context().close(); }
};

it.each(["film.webm", "film.mp4", "film.ogv", "playlist.m3u8", "stream"])(
  "retains the poster and branding without downloading %s", async file => {
    const result=await run(`?file=${file}`);
    expect(fetched).toContain('/poster.svg');
    expect(fetched).not.toContain(`/${file}`);
    expect(result.metrics.blocked.media).toBeGreaterThan(0);
    expect(result.data.capture).toMatchObject({media_policy:'static-branding',blocked_subresources:0});
    expect(result.data.fontSizes).toContainEqual(expect.objectContaining({size:'48px'}));
    const rgba=await pixel(result.screenshot);
    expect(rgba[0]).toBeGreaterThan(180);expect(rgba[1]).toBeLessThan(100);expect(rgba[2]).toBeLessThan(110);
    expect(result.metrics.close_confirmed).toBe(true);
  });
it('preserves the styled video box without a poster and does not require a decoded frame',async()=>{
  const result=await run('?poster=none');
  expect(fetched).not.toContain('/film.webm');
  expect(fetched).not.toContain('/poster.svg');
  const rgba=await pixel(result.screenshot);
  expect(rgba.slice(0,3).every(value=>value<15)).toBe(true);
  expect(result.data.borderRadius).toContainEqual(expect.objectContaining({radius:'12px'}));
});
it('excludes explicit media fetch/XHR downloads but preserves ordinary application data',async()=>{
  const result=await run('?fetch=1');
  expect(fetched).not.toContain('/film.mp4');expect(fetched).not.toContain('/segments.m4s');
  expect(fetched).toContain('/application-data');
  expect(result.metrics.blocked.media).toBeGreaterThanOrEqual(4);
});
it('waits for a visible poster before taking its photograph',async()=>{
  const result=await run('?poster=slow-poster.svg');
  expect((await pixel(result.screenshot))[0]).toBeGreaterThan(180);
  expect(result.metrics.pending_images).toBe(0);
});
it('rejects a broken visible poster instead of claiming complete image evidence',async()=>{
  await expect(run('?poster=missing-poster.svg')).rejects.toMatchObject({code:'CAPTURE_INCOMPLETE'});
  expect(fetched).not.toContain('/film.webm');
  expect(browser.contexts()).toHaveLength(0);
});
