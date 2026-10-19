import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import type { Page } from "@cloudflare/playwright";
import { screenshotSections } from "../src/capture-sections";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent(`<style>body{margin:0;height:3500px;background:#112233}</style>
    <header style="position:fixed;top:0;left:0;width:100%;height:60px;background:#abcdef">Header</header>`);
  return page;
}

for (const newHeight of [1700, 4500]) {
  it(`discards old tiles and recomposes once after height changes to ${newHeight}`, async () => {
    const page = await fixture();
    try {
      const original = await page.locator("header").getAttribute("style");
      let calls = 0;
      const result = await screenshotSections(page as unknown as Page, 4000, 12000, async () => {
        // Initial readiness changes the page before any photograph exists.
        // It must not consume the one retry needed by the later change.
        if (++calls === 1) await page.evaluate(() => document.body.style.height = "3400px");
        if (calls === 2) await page.evaluate(height => {
          document.body.style.height = `${height === 1700 ? 1900 : height}px`;
          document.body.style.background = "#226644";
          if (height === 1700) {
            // A lazy region can resize in several steps. The retry must wait
            // for the final height rather than consume its only attempt early.
            setTimeout(() => document.body.style.height = "1800px", 100);
            setTimeout(() => document.body.style.height = "1700px", 250);
          }
        }, newHeight);
      });
      expect(result.attempts).toBe(2);
      expect(result.height).toBe(Math.min(4000, newHeight));
      expect(result.documentHeight).toBe(newHeight);
      expect(result.tiles.reduce((sum, tile) => sum + tile.height, 0)).toBe(result.height);
      let next = 0;
      for (const tile of result.tiles) { expect(tile.outputY).toBe(next); next += tile.height; }
      const pixels = await page.evaluate(async encoded => {
        const img = new Image(); img.src = `data:image/jpeg;base64,${encoded}`; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
        return {height: img.height, samples: [100, 920, img.height - 10].map(y => [...ctx.getImageData(20, y, 1, 1).data].slice(0, 3))};
      }, result.screenshot.toString("base64"));
      expect(pixels.height).toBe(result.height);
      for (const pixel of pixels.samples) pixel.forEach((value, i) => expect(Math.abs(value - [34, 102, 68][i])).toBeLessThan(10));
      expect(await page.locator("header").getAttribute("style")).toBe(original);
    } finally { await page.close(); }
  });
}

it("stops after the second layout change and restores inline styles", async () => {
  const page = await fixture();
  try {
    const original = await page.locator("header").getAttribute("style");
    let calls = 0;
    await expect(screenshotSections(page as unknown as Page, 4000, 12000, async () => {
      calls++;
      if (calls % 2 === 0) await page.evaluate(height => document.body.style.height = `${height}px`, 3500 - calls * 250);
    })).rejects.toMatchObject({ code: "CAPTURE_LAYOUT_CHANGED" });
    expect(calls).toBe(4);
    expect(await page.locator("header").getAttribute("style")).toBe(original);
  } finally { await page.close(); }
});

it("does not renew the deadline for recomposition", async () => {
  const page = await fixture();
  try {
    const screenshot = page.screenshot.bind(page);
    let photographs = 0;
    page.screenshot = async options => {
      const frame = await screenshot(options);
      if (++photographs === 1) await page.evaluate(() => document.body.style.height = "1700px");
      return frame;
    };
    let calls = 0;
    await expect(screenshotSections(page as unknown as Page, 4000, 1000, async () => {
      calls++;
      // Each wait fits a fresh 1000 ms deadline; together they do not.
      await page.waitForTimeout(calls === 1 ? 250 : 700);
    })).rejects.toMatchObject({ code: "SCRAPE_TIMEOUT" });
    expect(calls).toBe(2);
  } finally { await page.close(); }
});
