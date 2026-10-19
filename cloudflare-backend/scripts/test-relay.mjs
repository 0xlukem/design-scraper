import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const dir = await mkdtemp(join(tmpdir(), "design-scraper-relay-"));
const report = { kind: "local-workerd-private-relay", remote: false, provider_calls: 0,
  browser_run_sessions: 0, scenarios: [], captures: [], external_calls: 0, unexpected_network: [] };
const font = await readFile("../frontend/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2");
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#abcdef"/></svg>';
const fixture = JSON.parse(await readFile("tests/fixtures/contracts.json", "utf8"))[0];
let providerScenario = "";
const providerTargets = [];
const html = '<html><head><link rel="stylesheet" href="https://cdn.example/design.css"><script src="https://cdn.example/app.js"></script></head><body><h1>Relay measured heading</h1><div class="card">Public cross-origin resources<img src="https://cdn.example/image.svg" width="80" height="60"></div></body></html>';
let mf, browser;
try {
  await build({ entryPoints: ["tests/relay-runtime-entry.ts"], outfile: join(dir, "worker.mjs"), bundle: true,
    format: "esm", platform: "node", target: "es2022", external: ["cloudflare:workers", "node:*"], logLevel: "silent" });
  await build({ stdin: { contents: 'export {capture} from "./src/capture"; export {config} from "./src/config"; export {RelayResources} from "./src/relay-resources"; export {normalize} from "./src/domain/normalize"; export {renderDocuments,renderExports} from "./src/domain/renderers";',
    resolveDir: process.cwd(), loader: "ts" }, outfile: join(dir, "client.mjs"), bundle: true,
    format: "esm", platform: "node", target: "es2022", logLevel: "silent" });
  const outgoing = async request => {
    report.external_calls++;
    const url = new URL(request.url);
    if (["api.openai.com", "generativelanguage.googleapis.com"].includes(url.hostname)) {
      providerTargets.push(url.hostname);
      if (providerScenario.endsWith("redirect")) return new Response(null, { status: 302,
        headers: { location: "https://not-a-provider.example/credential-sink" } });
      if (url.pathname.endsWith(":countTokens")) return Response.json({ totalTokens: 1000 });
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(fixture.raw) }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
    }
    if (["cloudflare-dns.com", "dns.google"].includes(url.hostname)) {
      const name = url.searchParams.get("name");
      assert.ok(name?.endsWith(".example"));
      return Response.json({ Status: 0, Answer: url.searchParams.get("type") === "A"
        ? [{ type: 1, data: "93.184.216.34" }] : [] });
    }
    if (!url.hostname.endsWith(".example")) {
      report.unexpected_network.push(url.origin);
      throw new Error("Unexpected outbound target");
    }
    assert.equal(request.headers.has("authorization"), false);
    if (url.pathname === "/slow") return new Response(new ReadableStream());
    if (url.pathname === "/large") return new Response(new Uint8Array(3_000_000).fill(19));
    if (url.pathname === "/heavy") return new Response(new Uint8Array(7_500_000).fill(19));
    if (url.pathname === "/oversize") return new Response(new Uint8Array(8_100_000));
    if (url.pathname === "/design.css") return new Response(`@font-face{font-family:RelayGeist;src:url('https://${url.hostname}/font.woff2')} :root{--relay-brand:#123456;--relay-space:24px}body{font-family:RelayGeist;color:#123456}h1{font-size:${url.hostname === "cdn-two.example" ? 44 : 36}px}.card{padding:24px;border-radius:12px}@media(min-width:700px){.card{max-width:800px}}`, { headers: { "content-type": "text/css" } });
    if (url.pathname === "/font.woff2") return new Response(font, { headers: { "content-type": "font/woff2", "access-control-allow-origin": "*" } });
    if (url.pathname === "/app.js") return new Response('document.documentElement.dataset.relay="loaded"', { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/image.svg") return new Response(image, { headers: { "content-type": "image/svg+xml" } });
    if (url.pathname === "/page") return new Response(html, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/page-two") return new Response(html.replaceAll("cdn.example", "cdn-two.example"), { headers: { "content-type": "text/html" } });
    if (url.pathname === "/private-redirect") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    if (url.pathname === "/missing-css") return new Response(html.replace("/design.css", "/404.css"), { headers: { "content-type": "text/html" } });
    if (url.pathname === "/404.css") return new Response(null, { status: 404 });
    if (url.pathname.startsWith("/asset-")) return new Response(new Uint8Array(55200).fill(137));
    throw new Error("Unexpected fixture path");
  };
  mf = new Miniflare(convertV4MiniflareOptions({ script: await readFile(join(dir, "worker.mjs"), "utf8"),
    modules: true, compatibilityDate: "2026-09-09", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    durableObjects: { RESOURCE_RELAY: { className: "ResourceRelay", useSQLite: true },
      COORDINATOR: { className: "RelayCoordinator", useSQLite: true } }, outboundService: outgoing }));
  for (const scenario of ["single", "mix", "heavy-mix", "aggregate", "oversize", "cancel", "deadline"]) {
    const start = performance.now();
    const before = report.external_calls;
    const response = await mf.dispatchFetch(`https://test/${scenario}`);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    result.wall_ms = Math.round(performance.now() - start);
    result.observed_external_calls = report.external_calls - before;
    const invocationCalls = result.sources.flatMap(source => source.transport.invocations).reduce((sum, metric) => sum + metric.external_calls, 0);
    assert.equal(invocationCalls, result.observed_external_calls, JSON.stringify(result));
    assert.ok(result.parent_internal_calls <= 800);
    for (const source of result.sources) {
      assert.equal(source.transport.cleanup_confirmed, true);
      assert.equal(source.transport.metrics_complete, true);
      assert.ok(source.transport.peak_active <= 4);
      assert.ok(source.transport.invocations.every(metric => metric.external_calls <= 8 && metric.closed));
      if (["single", "mix"].includes(scenario)) assert.equal(source.completed, 152);
      else if (scenario === "heavy-mix") {
        assert.equal(source.completed, 4);
        assert.equal(source.metrics.bytes_completed, 30_000_000);
        assert.equal(source.error, undefined);
      }
      else assert.ok(source.error);
      if (["cancel", "deadline"].includes(scenario)) assert.equal(source.completed, 0);
    }
    report.scenarios.push(result);
    console.log(`relay workerd ${scenario}: ${result.parent_internal_calls} internal calls, ${invocationCalls} external calls, ${result.wall_ms} ms; teardown confirmed`);
  }
  report.provider_replays = [];
  for (providerScenario of ["provider-openai", "provider-openai-redirect", "provider-gemini-redirect"]) {
    const before = providerTargets.length;
    const result = await (await mf.dispatchFetch(`https://test/${providerScenario}`)).json();
    assert.equal(providerTargets.length - before, 1);
    if (providerScenario.endsWith("redirect")) assert.deepEqual(result, { success: false, code: "PROVIDER_REQUEST_REJECTED" });
    else assert.deepEqual(result, { success: true, tokens: 30 });
    report.provider_replays.push({ scenario: providerScenario, ...result });
  }
  const { RelayResources, capture, config, normalize, renderDocuments, renderExports } = await import(pathToFileURL(join(dir, "client.mjs")).href);
  const capturedSources = [];
  browser = await chromium.launch({ headless: true });
  for (const path of ["page", "page-two", "private-redirect", "missing-css"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const client = new RelayResources(() => {
      const id = crypto.randomUUID();
      return { fetch: (input, init) => mf.dispatchFetch(`https://test/job/${id}${new URL(input).pathname}`, init) };
    }, controller.signal, Date.now() + 12000);
    try {
      const result = await capture(browser, `https://site.example/${path}`, config({}), controller.signal, undefined, client);
      assert.ok(["page", "page-two"].includes(path));
      assert.ok(result.data.fonts.some(item => item.font.includes("RelayGeist")));
      assert.ok(result.data.cssVariables["--relay-brand"]);
      assert.ok(result.data.elementMeasurements?.length || result.data.measurements);
      assert.ok(result.screenshot.length > 1000);
      report.captures.push({ path, success: true, metrics: result.metrics });
      capturedSources.push({ label: path === "page" ? "web_1" : "web_2", url: `https://site.example/${path}`,
        weight: path === "page" ? 25 : 75, data: result.data, screenshot: result.screenshot });
    } catch (error) {
      if (["page", "page-two"].includes(path)) throw error;
      assert.equal(error.code, path === "private-redirect" ? "UNSAFE_URL" : "CAPTURE_INCOMPLETE");
      assert.equal(error.captureMetrics.close_confirmed, true);
      assert.equal(error.captureMetrics.transport.cleanup_confirmed, true);
      report.captures.push({ path, success: false, code: error.code, metrics: error.captureMetrics });
    } finally { clearTimeout(timer); }
    console.log(`relay Chromium ${path}: checked`);
  }
  const modelFixture = structuredClone(fixture.raw);
  modelFixture.evidence.sources = capturedSources.map(({ label, url, weight }) => ({
    label, url, weight, status: "analyzed",
  }));
  const system = normalize(JSON.stringify(modelFixture), capturedSources);
  for (const [slot, value] of [["web_1", "36px"], ["web_2", "44px"]]) {
    const heading = system.typography.scale.find(row => row.name.startsWith(`measured-${slot.replace("_", "-")}-heading-`)
      && row.size?.value === value);
    assert.deepEqual(heading?.size?.source, [slot]);
  }
  const documents = renderDocuments(system), exports = renderExports(system);
  const outputs = [documents.extended, documents.compact, exports.css_variables, exports.tailwind, exports.design_tokens];
  // Both measured values must survive the same production normalizer/renderers.
  // This is a fixture replay, not another model generation.
  for (const output of outputs) {
    assert.ok(output, "Missing export");
    const serialized = typeof output === "string" ? output : JSON.stringify(output);
    assert.match(serialized, /36px/); assert.match(serialized, /44px/);
  }
  report.mix_replay = { sources: capturedSources.map(({ label, weight }) => ({ label, weight })),
    export_count: outputs.length, measured_heading_px: [36, 44], provider: "fixture" };
  assert.deepEqual(report.unexpected_network, []);
  // Local process memory is a lab measurement, never Cloudflare isolate memory/CPU.
  report.node_memory = process.memoryUsage();
  report.authoritative_cloudflare_cpu_ms = null;
  report.authoritative_cloudflare_memory_bytes = null;
  const output = resolve("reports/relay-local.json");
  await mkdir(resolve("reports"), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Local relay report: ${output}`);
} finally {
  await browser?.close();
  await mf?.dispose();
  await rm(dir, { recursive: true, force: true });
}
