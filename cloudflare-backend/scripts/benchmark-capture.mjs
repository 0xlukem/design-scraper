#!/usr/bin/env node

// Phase 10R local capture benchmark.
//
// This runner deliberately builds the current capture implementation at startup
// and uses local Playwright plus a local relay simulation by default. It does not
// load the Worker, Browser Run, provider, or any credentials.

import { build } from "esbuild";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const BACKEND_DIR = resolve(dirname(SCRIPT_FILE), "..");
const REPO_DIR = resolve(BACKEND_DIR, "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_DIR, "output/playwright/phase10r-2026-09-12/runner");

// Keep this matrix byte-for-byte aligned with the 2026-09-10 Phase 10R
// benchmark-matrix.mjs. A subset is allowed only when selected explicitly.
const SITES = Object.freeze([
  ["openai", "https://openai.com/"],
  ["vercel", "https://vercel.com/"],
  ["google", "https://www.google.com/"],
  ["linear", "https://linear.app/"],
  ["notion", "https://www.notion.com/"],
  ["github", "https://github.com/"],
  ["stripe", "https://stripe.com/"],
  ["tailwind", "https://tailwindcss.com/"],
  ["wikipedia", "https://www.wikipedia.org/"],
  ["mdn", "https://developer.mozilla.org/"],
]);

const PROFILE = {
  name: "static-branding",
  scrapeMs: Number(process.argv.find(x=>x.startsWith("--scrape-ms="))?.split("=")[1] || 60000),
  maxNetworkRequests: 600,
  maxRedirects: 5,
  maxScreenshotHeight: 4_000,
  maxScreenshotBytes: 2_000_000,
  maxElements: 3_000,
  resourceBytes: 8_000_000,
  totalBytes: 32_000_000,
  relayConcurrency: 4,
  experimental: false,
};

if (![25000,40000,60000].includes(PROFILE.scrapeMs)) throw new Error("Capture deadlines: 25000, 40000 or 60000 ms only");

const CAPTURE_ENV = Object.freeze({
  SCRAPE_TIMEOUT_MS: String(PROFILE.scrapeMs),
  ANALYSIS_TIMEOUT_MS: String(Math.max(180000,100000+2*PROFILE.scrapeMs)),
  MAX_NETWORK_REQUESTS: String(PROFILE.maxNetworkRequests),
  MAX_REDIRECTS: String(PROFILE.maxRedirects),
  MAX_SCREENSHOT_HEIGHT: String(PROFILE.maxScreenshotHeight),
  MAX_SCREENSHOT_BYTES: String(PROFILE.maxScreenshotBytes),
  MAX_ELEMENTS: String(PROFILE.maxElements),
});

const CAPTURE_ENTRY = `
  export { capture } from "./src/capture";
  export { config } from "./src/config";
  export { PublicNetwork } from "./src/url-safety";
  export { PublicResources } from "./src/public-resources";
  export { RELAY } from "./src/relay-protocol";
  export { RelayBudget, RelayResources } from "./src/relay-resources";
  export { RelayJob } from "./src/resource-relay";
`;

const SOURCE_FILES = [
  "src/capture.ts",
  "src/capture-sections.ts",
  "src/config.ts",
  "src/public-resources.ts",
  "src/url-safety.ts",
  "src/capture-css.ts",
  "src/capture-readiness.ts",
  "src/capture-region.ts",
  "src/domain/classify.ts",
  "src/domain/extraction-script.ts",
  "src/domain/measurement-script.ts",
  "src/relay-protocol.ts",
  "src/relay-resources.ts",
  "src/resource-relay.ts",
];

function usage() {
  console.log(`Usage:
  node cloudflare-backend/scripts/benchmark-capture.mjs [options]

Options:
  --sites all|openai,vercel,...   Explicit site subset; defaults to all 10 sites
  --selected-subset names         Alias for --sites
  --repetitions N                 Repetitions per selected site; default: 2
  --transport relay-local|public  Local simulated relay (default) or historical PublicResources
  --requests 200|600              Experimental local request ceiling; does not alter production
  --relay-concurrency 2|4         Experimental local relay concurrency; does not alter production
  --run-id ID                     Output directory name under the runner directory
  --output-dir PATH               Override the output directory
  --compile-only                  Build current capture modules without network/browser work
  --help                          Show this message

The normal Phase 10R invocation is:
  node cloudflare-backend/scripts/benchmark-capture.mjs --transport relay-local --sites all --repetitions 2 --run-id phase10r-2026-09-12-normal
`);
}

function option(argv, names) {
  for (const name of names) {
    const exact = argv.indexOf(name);
    if (exact !== -1) {
      if (exact + 1 >= argv.length || argv[exact + 1].startsWith("--"))
        throw new Error(`${name} requires a value`);
      return argv[exact + 1];
    }
    const prefix = `${name}=`;
    const inline = argv.find((value) => value.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
  }
  return undefined;
}

function hasOption(argv, name) {
  return argv.includes(name) || argv.some((value) => value.startsWith(`${name}=`));
}

function parseCli(argv) {
  if (hasOption(argv, "--help")) {
    usage();
    process.exit(0);
  }
  const subsetValue = option(argv, ["--sites", "--selected-subset"]);
  const repetitionsValue = option(argv, ["--repetitions"]);
  const transport = option(argv, ["--transport"]) || "relay-local";
  const outputValue = option(argv, ["--output-dir"]);
  const runId = option(argv, ["--run-id"]);
  const repetitions = repetitionsValue === undefined ? 2 : Number(repetitionsValue);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
    throw new Error("--repetitions must be an integer from 1 to 10");

  const byName = new Map(SITES);
  const requested = !subsetValue || subsetValue === "all"
    ? SITES.map(([name]) => name)
    : subsetValue.split(",").map((name) => name.trim()).filter(Boolean);
  if (!requested.length) throw new Error("--sites must select at least one site");
  const unknown = requested.filter((name) => !byName.has(name));
  if (unknown.length) throw new Error(`Unknown site(s): ${unknown.join(", ")}`);
  if (new Set(requested).size !== requested.length)
    throw new Error("--sites cannot contain duplicates");
  if (!["relay-local", "public"].includes(transport))
    throw new Error("--transport must be relay-local or public");

  const defaultId = `local-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  return {
    sites: requested.map((name) => [name, byName.get(name)]),
    repetitions,
    transport,
    runId: runId || defaultId,
    outputDir: resolve(REPO_DIR, outputValue || DEFAULT_OUTPUT_DIR),
    compileOnly: hasOption(argv, "--compile-only"),
  };
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

async function writeJson(path, value) {
  await writeFile(path, `${json(value)}\n`);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicUrl(raw) {
  try {
    const url = new URL(String(raw));
    return `${url.origin}${url.pathname}`.slice(0, 512);
  } catch {
    return String(raw).slice(0, 512);
  }
}

function boundedError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || null,
    message: String(error?.message || error).slice(0, 1000),
    retryable: error?.retryable === true,
  };
}

async function sourceFingerprints() {
  return Object.fromEntries(await Promise.all(SOURCE_FILES.map(async (relative) => {
    const bytes = await readFile(join(BACKEND_DIR, relative));
    return [relative, hash(bytes)];
  })));
}

const cloudflareWorkersShimPlugin = {
  name: "phase10r-cloudflare-workers-shim",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
      path: "phase10r-cloudflare-workers-shim",
      namespace: "phase10r-shim",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "phase10r-shim" }, () => ({
      contents: "export class DurableObject { constructor(state, env) { this.ctx = state; this.env = env; } }",
      loader: "js",
    }));
  },
};

async function buildCurrentCapture() {
  const temp = await mkdtemp(join(tmpdir(), "design-scraper-phase10r-"));
  const bundlePath = join(temp, "capture-entry.mjs");
  await build({
    stdin: { contents: CAPTURE_ENTRY, resolveDir: BACKEND_DIR, loader: "ts" },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    plugins: [cloudflareWorkersShimPlugin],
    logLevel: "silent",
  });
  const bundle = await readFile(bundlePath);
  const module = await import(`${pathToFileURL(bundlePath).href}?sha256=${hash(bundle)}`);
  return {
    temp,
    module,
    bundleSha256: hash(bundle),
    sourceSha256: await sourceFingerprints(),
  };
}

async function packageVersion(name) {
  try {
    const packagePath = join(BACKEND_DIR, "node_modules", name, "package.json");
    return JSON.parse(await readFile(packagePath, "utf8")).version;
  } catch {
    return "unknown";
  }
}

function instrumentBrowser(browser, outputDir, startedAt) {
  let page;
  let cdp;
  let diagnosticDone = false;
  const requestRows = [];
  const requestByObject = new WeakMap();
  let requestCount = 0;
  let omittedRequests = 0;
  const elapsed = () => Math.round(performance.now() - startedAt);

  const captureDiagnostic = async () => {
    if (diagnosticDone) return;
    diagnosticDone = true;
    const diagnostic = {
      capturedAt: new Date().toISOString(),
      requestCount,
      omittedRequests,
      page: null,
      screenshot: null,
    };
    try {
      if (page) {
        diagnostic.page = await page.evaluate(() => {
          const clipped = (value, max) => String(value || "").slice(0, max);
          const box = (node) => {
            const rect = node.getBoundingClientRect();
            return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
          };
          return {
            title: clipped(document.title, 512),
            url: `${location.origin}${location.pathname}`.slice(0, 512),
            readyState: document.readyState,
            height: document.documentElement.scrollHeight,
            elements: document.querySelectorAll("*").length,
            fonts: document.fonts.status,
            bodyText: clipped(document.body?.innerText, 1000),
            images: [...document.images].slice(0, 80).map((image) => ({
              src: clipped(image.currentSrc || image.src, 512),
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              box: box(image),
            })),
          };
        });
        let screenshot;
        if (cdp) screenshot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60, captureBeyondViewport: false });
        else screenshot = { data: (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64") };
        if (screenshot?.data) {
          await writeFile(join(outputDir, "viewport.jpg"), Buffer.from(screenshot.data, "base64"));
          diagnostic.screenshot = "viewport.jpg";
        }
      }
    } catch (error) {
      diagnostic.pageError = boundedError(error);
    }
    await writeJson(join(outputDir, "diagnostic.json"), diagnostic);
  };

  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await originalNewContext(...args);
    const originalNewPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      page = await originalNewPage(...pageArgs);
      try {
        cdp = await context.newCDPSession(page);
        await cdp.send("Page.enable");
      } catch {
        cdp = undefined;
      }
      page.on("request", (request) => {
        requestCount++;
        const row = {
          n: requestCount,
          ms: elapsed(),
          type: request.resourceType(),
          method: request.method(),
          navigation: request.isNavigationRequest(),
          url: publicUrl(request.url()),
        };
        requestByObject.set(request, row);
        if (requestRows.length < PROFILE.maxNetworkRequests + 32) requestRows.push(row);
        else omittedRequests++;
      });
      page.on("response", (response) => {
        const row = requestByObject.get(response.request());
        if (row) row.status = response.status();
      });
      page.on("requestfailed", (request) => {
        const row = requestByObject.get(request);
        if (row) row.failure = String(request.failure()?.errorText || "failed").slice(0, 256);
      });
      return page;
    };
    const originalClose = context.close.bind(context);
    context.close = async (...closeArgs) => {
      await captureDiagnostic();
      return originalClose(...closeArgs);
    };
    return context;
  };
  const originalBrowserClose = browser.close.bind(browser);
  browser.close = async (...closeArgs) => {
    await captureDiagnostic();
    return originalBrowserClose(...closeArgs);
  };

  return {
    requestRows,
    get requestCount() { return requestCount; },
    get omittedRequests() { return omittedRequests; },
    captureDiagnostic,
  };
}

async function runCapture({ capture, config, PublicNetwork, PublicResources, RelayBudget, RelayResources, RelayJob }, transport, site, url, repeat, runDir, runtime) {
  const id = `${site}-r${repeat}`;
  const outputDir = join(runDir, id);
  await mkdir(outputDir, { recursive: true });
  const controller = new AbortController();
  const startedAt = performance.now();
  const startedIso = new Date().toISOString();
  const loads = [];
  const dns = [];
  const relayExternal = [];
  let relayJobs = 0;
  let browser;
  let instrumentation;
  let result;
  let failure;

  const dnsFetch = async (input, init) => {
    const row = { ms: Math.round(performance.now() - startedAt), url: publicUrl(input) };
    if (dns.length < PROFILE.maxNetworkRequests + 32) dns.push(row);
    try {
      const response = await fetch(input, init);
      row.status = response.status;
      return response;
    } catch (error) {
      row.error = boundedError(error);
      throw error;
    }
  };

  const relayBudget = new RelayBudget();
  const makeRelayStub = () => {
    const jobNumber = ++relayJobs;
    const relayFetch = async (input, init) => {
      const row = { job: jobNumber, ms: Math.round(performance.now() - startedAt), url: publicUrl(input) };
      if (relayExternal.length < PROFILE.maxNetworkRequests * 2 + 64) relayExternal.push(row);
      try {
        const response = await fetch(input, init);
        row.status = response.status;
        return response;
      } catch (error) {
        row.error = boundedError(error);
        throw error;
      }
    };
    const job = new RelayJob(relayFetch);
    return { fetch: (input, init) => job.fetch(new Request(input, init)) };
  };
  const resourceController = transport === "relay-local"
    ? new RelayResources(makeRelayStub, controller.signal, Date.now() + PROFILE.scrapeMs, relayBudget, PROFILE.totalBytes)
    : new PublicResources(fetch, controller.signal, {
      resourceBytes: PROFILE.resourceBytes,
      totalBytes: PROFILE.totalBytes,
    });
  const resources = {
    metrics: resourceController.metrics,
    validatesNetwork: resourceController.validatesNetwork === true,
    ...(resourceController.transport ? { transport: resourceController.transport } : {}),
    cancel: () => resourceController.cancel(),
    ...(resourceController.close ? { close: () => resourceController.close() } : {}),
    load: async (input) => {
      const row = { ms: Math.round(performance.now() - startedAt), url: publicUrl(input.url) };
      if (loads.length < PROFILE.maxNetworkRequests + 32) loads.push(row);
      try {
        const loaded = await resourceController.load(input);
        row.status = loaded.status;
        row.bytes = loaded.body.byteLength;
        return loaded;
      } catch (error) {
        row.error = boundedError(error);
        throw error;
      }
    },
  };
  const timeout = setTimeout(() => controller.abort(), PROFILE.scrapeMs);

  try {
    browser = await chromium.launch({ headless: true });
    runtime.browserVersion ||= await browser.version();
    instrumentation = instrumentBrowser(browser, outputDir, startedAt);
    const captureConfig = { ...config(CAPTURE_ENV), requests: PROFILE.maxNetworkRequests };
    result = await capture(
      browser,
      url,
      captureConfig,
      controller.signal,
      new PublicNetwork(dnsFetch, controller.signal),
      resources,
    );
    await writeFile(join(outputDir, "capture.jpg"), Buffer.from(result.screenshot, "base64"));
    await writeJson(join(outputDir, "evidence.json"), result.data);
  } catch (error) {
    failure = error;
    await writeJson(join(outputDir, "error.json"), boundedError(error));
  } finally {
    clearTimeout(timeout);
    await instrumentation?.captureDiagnostic();
    await browser?.close().catch((error) => {
      if (!failure) failure = error;
    });
    controller.abort();
  }

  const finishedIso = new Date().toISOString();
  const outcome = result ? "OK" : failure?.code || failure?.name || "FAILED";
  const captureMetrics = result?.metrics || failure?.captureMetrics || null;
  const metric = {
    id,
    site,
    url,
    repetition: repeat,
    startedAt: startedIso,
    finishedAt: finishedIso,
    outcome,
    wallMs: Math.round(performance.now() - startedAt),
    transport: {
      name: transport === "relay-local" ? "relay-local-simulated-do" : "public-resource-node-fetch",
      browser: "local-playwright-chromium",
      validatedBy: "PublicNetwork",
      relayConcurrency: transport === "relay-local" ? PROFILE.relayConcurrency : null,
      relayBudgetCalls: transport === "relay-local" ? relayBudget.calls : null,
      relayJobs,
      remoteBrowserRunCalls: 0,
      aiCalls: 0,
      relayCalls: 0,
    },
    profile: PROFILE,
    captureMetrics,
    requestCount: instrumentation?.requestCount || 0,
    omittedRequestRows: instrumentation?.omittedRequests || 0,
    resourceFetches: loads.length,
    dnsFetches: dns.length,
    bytesCompleted: resourceController.metrics.bytes_completed,
    failedResourceFetches: resourceController.metrics.failed,
    relayExternalCalls: relayExternal.length,
    relayTransport: resourceController.transport || null,
    diagnostic: "diagnostic.json",
    artifacts: result
      ? ["capture.jpg", "evidence.json", "diagnostic.json", "viewport.jpg", "metrics.json", "requests.json"]
      : ["error.json", "diagnostic.json", "viewport.jpg", "metrics.json", "requests.json"],
  };
  await writeJson(join(outputDir, "metrics.json"), metric);
  await writeJson(join(outputDir, "requests.json"), {
    rows: instrumentation?.requestRows || [],
    dns,
    loads,
    relayExternal,
    relayTransport: resourceController.transport || null,
    limits: { requestRows: PROFILE.maxNetworkRequests + 32 },
  });
  return metric;
}

const cli = parseCli(process.argv.slice(2));
const requestCap = Number(option(process.argv.slice(2), ["--requests"]) || 600);
const relayConcurrency = Number(option(process.argv.slice(2), ["--relay-concurrency"]) || 2);
if (![200, 600].includes(requestCap) || ![2, 4].includes(relayConcurrency))
  throw new Error("Experimental profiles accept requests 200/600 and relay concurrency 2/4 only");
PROFILE.maxNetworkRequests = requestCap;
PROFILE.relayConcurrency = relayConcurrency;
PROFILE.experimental = requestCap !== 600 || relayConcurrency !== 2;
PROFILE.name = PROFILE.experimental ? `experimental-r${requestCap}-c${relayConcurrency}` : "static-branding";
const buildResult = await buildCurrentCapture();
buildResult.module.RELAY.concurrency = relayConcurrency;
PROFILE.resourceBytes = buildResult.module.RELAY.resourceBytes;
PROFILE.totalBytes = buildResult.module.RELAY.totalBytes;
try {
  const runtime = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    playwright: await packageVersion("playwright"),
    browserExecutable: chromium.executablePath(),
    browserVersion: null,
  };
  const source = {
    entry: "cloudflare-backend/src/capture.ts",
    bundleSha256: buildResult.bundleSha256,
    sourceSha256: buildResult.sourceSha256,
    builtAt: new Date().toISOString(),
  };
  if (cli.compileOnly) {
    console.log(json({
      compileOnly: true,
      runtime,
      source,
      profile: PROFILE,
      transport: cli.transport,
      urlMatrix: SITES,
      selectedSites: cli.sites.map(([name]) => name),
      repetitions: cli.repetitions,
      networkBenchmarkExecuted: false,
      remoteBrowserRunCalls: 0,
      aiCalls: 0,
    }));
    process.exit(0);
  }

  const runDir = join(cli.outputDir, cli.runId);
  await mkdir(runDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    benchmark: "Phase10R-fixed10sites",
    runId: cli.runId,
    status: "running",
    startedAt: new Date().toISOString(),
    selectedSites: cli.sites.map(([name]) => name),
    repetitions: cli.repetitions,
    urlMatrix: SITES,
    profile: PROFILE,
    transport: {
      name: cli.transport === "relay-local" ? "relay-local-simulated-do" : "public-resource-node-fetch",
      localChromium: true,
      publicNetworkValidation: true,
      relayConcurrency: cli.transport === "relay-local" ? PROFILE.relayConcurrency : null,
      relayDispatch: cli.transport === "relay-local" ? "RelayJob via Node Request shim" : null,
      remoteBrowserRunCalls: 0,
      aiCalls: 0,
      productionDeployment: false,
    },
    runtime,
    source,
    baseline: {
      harness: "output/playwright/phase10r-2026-09-10/benchmark-matrix.mjs",
      report: "output/playwright/phase10r-2026-09-10/REPORT.md",
      urlsPreserved: true,
    },
  };
  await writeJson(join(runDir, "manifest.json"), manifest);

  const results = [];
  for (let repetition = 1; repetition <= cli.repetitions; repetition++) {
    for (const [site, url] of cli.sites) {
      const metric = await runCapture(buildResult.module, cli.transport, site, url, repetition, runDir, runtime);
      results.push(metric);
      await writeJson(join(runDir, "manifest.json"), {
        ...manifest,
        runtime,
        progress: { completed: results.length, total: cli.sites.length * cli.repetitions },
      });
      console.log(JSON.stringify({ id: metric.id, outcome: metric.outcome, requests: metric.requestCount, seconds: metric.wallMs / 1000 }));
    }
  }

  const summary = {
    benchmark: manifest.benchmark,
    runId: cli.runId,
    finishedAt: new Date().toISOString(),
    attempted: results.length,
    successful: results.filter((result) => result.outcome === "OK").length,
    failed: results.filter((result) => result.outcome !== "OK").length,
    results: results.map(({ id, site, url, repetition, outcome, wallMs, requestCount, bytesCompleted }) => ({
      id, site, url, repetition, outcome, wallMs, requestCount, bytesCompleted,
    })),
    remoteBrowserRunCalls: 0,
    aiCalls: 0,
  };
  await writeJson(join(runDir, "summary.json"), summary);
  await writeJson(join(runDir, "manifest.json"), { ...manifest, status: "complete", finishedAt: summary.finishedAt, runtime, summary: "summary.json" });
  console.log(json(summary));
} finally {
  await rm(buildResult.temp, { recursive: true, force: true });
}
