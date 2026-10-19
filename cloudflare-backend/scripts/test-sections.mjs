import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../tests/sections-fixture.html');
const prototypePath = join(here, '../src/capture-sections.ts');
const viewport = { width: 1440, height: 900 };
const captureHeight = 4000;
const captureTimeoutMs = 15_000;
const bandHeight = 500;
const expectedBands = [
  [21, 33, 48],
  [216, 195, 155],
  [33, 67, 55],
  [87, 59, 98],
  [37, 75, 112],
  [154, 88, 61],
  [39, 97, 93],
  [114, 92, 45],
];
const headerColor = [246, 242, 232];
const lazyMarkerColor = [124, 255, 107];
const canvasMarkerColor = [255, 46, 99];
const fadeMarkerColor = [161, 255, 15];
const fixedButtonColor = [244, 211, 94];
const stickyStripColor = [244, 91, 105];

function fail(message) {
  throw new Error(`CAPTURE_REJECTED: ${message}`);
}

function openFixtureServer(html) {
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url === '/sections-fixture.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  const listening = new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });

  return { server, listening };
}

async function loadScreenshotSections() {
  if (!existsSync(prototypePath)) {
    fail(`missing prototype ${prototypePath}; expected export screenshotSections(page, height, timeoutMs, beforeTile)`);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'design-scraper-sections-'));
  const temporaryModule = join(temporaryDirectory, 'section-screenshot.mjs');
  const backendNodeModules = resolve(here, '../node_modules');

  try {
    if (existsSync(backendNodeModules)) {
      await symlink(backendNodeModules, join(temporaryDirectory, 'node_modules'), 'dir');
    }
    await build({
      entryPoints: [prototypePath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      packages: 'external',
      outfile: temporaryModule,
      sourcemap: false,
      legalComments: 'none',
    });
    const loaded = await import(`${pathToFileURL(temporaryModule).href}?cacheBust=${Date.now()}`);
    if (typeof loaded.screenshotSections !== 'function') {
      fail('prototype does not export async screenshotSections(page, height, timeoutMs, beforeTile?)');
    }
    return {
      screenshotSections: loaded.screenshotSections,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function waitForVisibleFixtureResources(page) {
  await page.waitForFunction(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    };

    const lazySlotsReady = [...document.querySelectorAll('[data-lazy-slot]')]
      .filter(visible)
      .every((slot) => {
        const image = slot.querySelector('img');
        return image && image.complete && image.naturalWidth > 0;
      });
    const observerComponentsReady = [...document.querySelectorAll('[data-observer-component]')]
      .filter(visible)
      .every((element) => element.dataset.painted === 'true');
    return lazySlotsReady && observerComponentsReady;
  }, null, { timeout: 4_000 });
}

async function snapshotInlineStyles(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-style-probe]')].map((element) => ({
    selector: element.id || element.getAttribute('data-style-probe') || element.tagName.toLowerCase(),
    style: element.getAttribute('style'),
  })));
}

async function assertInlineStylesRestored(page, expected, context) {
  const actual = await snapshotInlineStyles(page);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`inline style attributes were not restored ${context}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function inspectJpegInCanvas(page, screenshot) {
  const encoded = Buffer.from(screenshot).toString('base64');
  return page.evaluate(async ({ encoded, expectedBands, headerColor, lazyMarkerColor, canvasMarkerColor, fadeMarkerColor, fixedButtonColor, stickyStripColor, bandHeight, captureHeight }) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${encoded}`;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Chromium could not decode returned JPEG'));
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixel = (x, y) => {
      const offset = (y * canvas.width + x) * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    };
    const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const near = (a, b, threshold = 42) => distance(a, b) <= threshold;
    const bandForRow = (row) => Math.min(expectedBands.length - 1, Math.floor(row / bandHeight));
    const runsForRows = (rows) => {
      const runs = [];
      for (const row of rows) {
        const previous = runs[runs.length - 1];
        if (!previous || row !== previous.end + 1) runs.push({ start: row, end: row });
        else previous.end = row;
      }
      return runs;
    };

    const seamChecks = [];
    for (let band = 0; band < expectedBands.length; band += 1) {
      const start = band * bandHeight;
      const rows = band === 0 ? [start + 100, start + 250, start + 498] : [start + 2, start + 100, start + 250, start + 498];
      for (const row of rows) {
        if (row >= captureHeight - 48) continue;
        for (const x of [8, canvas.width - 9]) {
          seamChecks.push({ row, x, expected: expectedBands[band], actual: pixel(x, row), ok: near(pixel(x, row), expectedBands[band]) });
        }
      }
    }

    const unexpectedBackgroundRows = [];
    for (let row = 80; row < canvas.height; row += 1) {
      if (row >= captureHeight - 48 || row % bandHeight === 0 || row % bandHeight === bandHeight - 1) continue;
      const expected = expectedBands[bandForRow(row)];
      const left = pixel(8, row);
      const right = pixel(canvas.width - 9, row);
      if (!near(left, expected) || !near(right, expected)) unexpectedBackgroundRows.push(row);
    }

    const headerRows = [];
    for (let row = 0; row < canvas.height; row += 1) {
      if (near(pixel(8, row), headerColor, 42)) headerRows.push(row);
    }
    const headerRuns = runsForRows(headerRows);

    const buttonLeft = canvas.width - 24 - 220;
    const buttonRight = canvas.width - 24;
    const fixedButtonRows = [];
    for (let row = 0; row < canvas.height; row += 1) {
      let matchingPixels = 0;
      for (let x = buttonLeft + 8; x < buttonRight - 8; x += 1) {
        if (near(pixel(x, row), fixedButtonColor, 75)) matchingPixels += 1;
      }
      if (matchingPixels >= 100) fixedButtonRows.push(row);
    }

    const stickyRows = [];
    for (let row = 0; row < canvas.height; row += 1) {
      if (near(pixel(8, row), stickyStripColor, 75)) stickyRows.push(row);
    }

    const sourcePoints = (selector) => [...document.querySelectorAll(selector)].map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + window.scrollY + rect.height / 2) };
    });
    const samplePoints = (selector, expected, threshold = 85) => sourcePoints(selector).map(({ x, y }) => ({
      x,
      y,
      actual: pixel(x, y),
      ok: near(pixel(x, y), expected, threshold),
    }));

    return {
      width: canvas.width,
      height: canvas.height,
      seamChecks,
      unexpectedBackgroundRows: unexpectedBackgroundRows.slice(0, 20),
      unexpectedBackgroundRowCount: unexpectedBackgroundRows.length,
      headerRows: headerRows.length,
      headerRuns,
      topHeaderSamples: [pixel(8, 0), pixel(8, 40), pixel(8, 79)],
      bottomSamples: [pixel(8, canvas.height - 2), pixel(canvas.width - 9, canvas.height - 2)],
      fixedButtonRuns: runsForRows(fixedButtonRows),
      stickyStripRuns: runsForRows(stickyRows),
      lazyMarkerSamples: samplePoints('[data-lazy-slot] img', lazyMarkerColor),
      canvasMarkerSamples: samplePoints('[data-observer-component] canvas', canvasMarkerColor),
      fadeMarkerSamples: samplePoints('[data-fade-marker]', fadeMarkerColor, 170),
      expectedButtonTop: 900 - 24 - 64,
      expectedButtonBottom: 900 - 24,
      expectedStickyTop: captureHeight - 48,
    };
  }, { encoded, expectedBands, headerColor, lazyMarkerColor, canvasMarkerColor, fadeMarkerColor, fixedButtonColor, stickyStripColor, bandHeight, captureHeight });
}

function verifyTiles(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) fail('screenshotSections returned no tile metadata');

  let expectedOutputY = 0;
  let previousScrollY = -1;
  for (const [index, tile] of tiles.entries()) {
    if (!tile || !Number.isInteger(tile.scrollY) || !Number.isInteger(tile.sourceY) || !Number.isInteger(tile.outputY) || !Number.isInteger(tile.height)) {
      fail(`tile ${index} has non-integer coordinates: ${JSON.stringify(tile)}`);
    }
    if (tile.scrollY < previousScrollY) fail(`tile ${index} scrollY moves backwards`);
    if (tile.sourceY < 0 || tile.outputY < 0 || tile.height <= 0) fail(`tile ${index} has invalid bounds: ${JSON.stringify(tile)}`);
    if (tile.sourceY + tile.height > viewport.height) fail(`tile ${index} samples beyond the viewport: ${JSON.stringify(tile)}`);
    if (tile.outputY !== expectedOutputY) {
      fail(`tile ${index} leaves an output gap or overlap: expected outputY ${expectedOutputY}, got ${tile.outputY}`);
    }
    expectedOutputY += tile.height;
    previousScrollY = tile.scrollY;
  }
  if (expectedOutputY !== captureHeight) fail(`tile output ends at ${expectedOutputY}px instead of ${captureHeight}px`);
}

async function main() {
  const html = await readFile(fixturePath, 'utf8');
  const fixtureServer = openFixtureServer(html);
  let browser;
  let temporaryModule;
  try {
    const { screenshotSections, cleanup } = await loadScreenshotSections();
    temporaryModule = cleanup;
    const listeningServer = await fixtureServer.listening;
    const address = listeningServer.address();
    assert(address && typeof address === 'object' && address.port, 'local fixture server did not expose a port');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/sections-fixture.html`, { waitUntil: 'load', timeout: captureTimeoutMs });
    await page.waitForFunction(() => Boolean(window.__sectionsFixture), null, { timeout: 2_000 });

    const stylesBeforeFailure = await snapshotInlineStyles(page);
    let callbackFailure;
    try {
      await screenshotSections(page, captureHeight, captureTimeoutMs, async () => {
        throw new Error('intentional beforeTile callback failure');
      });
    } catch (error) {
      callbackFailure = error;
    }
    if (!callbackFailure?.message?.includes('intentional beforeTile callback failure')) {
      fail(`expected beforeTile callback failure, got ${callbackFailure?.message || 'no error'}`);
    }
    await assertInlineStylesRestored(page, stylesBeforeFailure, 'after callback failure');

    await page.reload({ waitUntil: 'load', timeout: captureTimeoutMs });
    await page.waitForFunction(() => Boolean(window.__sectionsFixture), null, { timeout: 2_000 });
    const stylesBeforeCapture = await snapshotInlineStyles(page);

    let beforeTileCalls = 0;
    const beforeTile = async (candidatePage = page) => {
      beforeTileCalls += 1;
      await waitForVisibleFixtureResources(candidatePage && typeof candidatePage.waitForFunction === 'function' ? candidatePage : page);
      await (candidatePage && typeof candidatePage.waitForTimeout === 'function' ? candidatePage : page).waitForTimeout(70);
    };

    const result = await screenshotSections(page, captureHeight, captureTimeoutMs, beforeTile);
    if (!result || !result.screenshot) fail('screenshotSections returned no screenshot');
    const screenshot = Buffer.from(result.screenshot);
    if (screenshot.length < 4 || screenshot[0] !== 0xff || screenshot[1] !== 0xd8) fail('screenshot is not a JPEG buffer');
    verifyTiles(result.tiles);
    if (beforeTileCalls === 0) fail('beforeTile was never called before a photograph');
    await assertInlineStylesRestored(page, stylesBeforeCapture, 'after successful capture');

    const fixtureState = await page.evaluate(() => ({
      lazyInserted: window.__sectionsFixture.lazyInserted,
      painted: window.__sectionsFixture.painted,
      bands: window.__sectionsFixture.bands,
    }));
    if (fixtureState.lazyInserted !== fixtureState.bands) fail(`only ${fixtureState.lazyInserted}/${fixtureState.bands} lazy images were inserted`);
    if (fixtureState.painted !== fixtureState.bands) fail(`only ${fixtureState.painted}/${fixtureState.bands} observer components painted`);
    if (consoleErrors.length > 0) fail(`fixture emitted browser errors: ${consoleErrors.join(' | ')}`);

    const pixelReport = await inspectJpegInCanvas(page, screenshot);
    if (pixelReport.width !== viewport.width || pixelReport.height !== captureHeight) {
      fail(`JPEG canvas is ${pixelReport.width}x${pixelReport.height}; expected ${viewport.width}x${captureHeight}`);
    }
    if (pixelReport.unexpectedBackgroundRowCount > 20) {
      fail(`background continuity has ${pixelReport.unexpectedBackgroundRowCount} unexpected rows after the header; sample ${JSON.stringify(pixelReport.unexpectedBackgroundRows)}`);
    }
    const failedSeams = pixelReport.seamChecks.filter((check) => !check.ok);
    if (failedSeams.length > 0) fail(`band edge pixels do not match expected colors: ${JSON.stringify(failedSeams.slice(0, 6))}`);
    if (pixelReport.headerRuns.length !== 1 || pixelReport.headerRuns[0].start > 2 || pixelReport.headerRows < 70 || pixelReport.headerRows > 120) {
      fail(`fixed header is missing or repeated: ${JSON.stringify({ headerRuns: pixelReport.headerRuns, headerRows: pixelReport.headerRows, topHeaderSamples: pixelReport.topHeaderSamples })}`);
    }
    const failedLazyMarkers = pixelReport.lazyMarkerSamples.filter((sample) => !sample.ok);
    if (pixelReport.lazyMarkerSamples.length !== fixtureState.bands || failedLazyMarkers.length > 0) {
      fail(`delayed lazy image pixels are missing: ${JSON.stringify({ expected: fixtureState.bands, samples: pixelReport.lazyMarkerSamples, failed: failedLazyMarkers })}`);
    }
    const failedCanvasMarkers = pixelReport.canvasMarkerSamples.filter((sample) => !sample.ok);
    if (pixelReport.canvasMarkerSamples.length !== fixtureState.bands || failedCanvasMarkers.length > 0) {
      fail(`canvas marker pixels are missing: ${JSON.stringify({ expected: fixtureState.bands, samples: pixelReport.canvasMarkerSamples, failed: failedCanvasMarkers })}`);
    }
    const failedFadeMarkers = pixelReport.fadeMarkerSamples.filter((sample) => !sample.ok);
    if (pixelReport.fadeMarkerSamples.length !== 1 || failedFadeMarkers.length > 0) {
      fail(`finite fade marker did not settle visibly: ${JSON.stringify({ samples: pixelReport.fadeMarkerSamples, failed: failedFadeMarkers })}`);
    }
    if (pixelReport.fixedButtonRuns.length !== 1
      || pixelReport.fixedButtonRuns[0].start < pixelReport.expectedButtonTop - 3
      || pixelReport.fixedButtonRuns[0].start > pixelReport.expectedButtonTop + 5
      || pixelReport.fixedButtonRuns[0].end < pixelReport.expectedButtonBottom - 8
      || pixelReport.fixedButtonRuns[0].end > pixelReport.expectedButtonBottom + 2) {
      fail(`fixed button is not exactly once at bottom 24/right 24: ${JSON.stringify({ runs: pixelReport.fixedButtonRuns, expectedTop: pixelReport.expectedButtonTop, expectedBottom: pixelReport.expectedButtonBottom })}`);
    }
    if (pixelReport.stickyStripRuns.length !== 1
      || pixelReport.stickyStripRuns[0].start < pixelReport.expectedStickyTop
      || pixelReport.stickyStripRuns[0].start > pixelReport.expectedStickyTop + 5
      || pixelReport.stickyStripRuns[0].end < captureHeight - 2) {
      fail(`sticky strip is missing, repeated, or displaced: ${JSON.stringify({ runs: pixelReport.stickyStripRuns, expectedTop: pixelReport.expectedStickyTop })}`);
    }

    console.log(JSON.stringify({
      status: 'CAPTURE_ACCEPTED',
      fixture: 'sections-fixture.html',
      viewport,
      screenshotBytes: screenshot.length,
      tileCount: result.tiles.length,
      beforeTileCalls,
      fixtureState,
      styleRestoration: 'success and callback failure verified',
      pixelReport: {
        width: pixelReport.width,
        height: pixelReport.height,
        unexpectedBackgroundRowCount: pixelReport.unexpectedBackgroundRowCount,
        headerRuns: pixelReport.headerRuns,
        fixedButtonRuns: pixelReport.fixedButtonRuns,
        stickyStripRuns: pixelReport.stickyStripRuns,
        lazyMarkerCount: pixelReport.lazyMarkerSamples.length,
        canvasMarkerCount: pixelReport.canvasMarkerSamples.length,
        fadeMarkerCount: pixelReport.fadeMarkerSamples.length,
        bottomSamples: pixelReport.bottomSamples,
      },
    }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    await temporaryModule?.().catch(() => {});
    await new Promise((resolveServer) => fixtureServer.server.close(() => resolveServer()));
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
