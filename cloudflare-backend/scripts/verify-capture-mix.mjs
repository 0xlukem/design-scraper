#!/usr/bin/env node

// Offline capture-mix verifier. It replays saved capture evidence through the
// real provider envelope, normalizer, and renderers, but the provider request is
// always fulfilled by fakeFetch and never reaches the network.

import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURES_FILE = join(BACKEND_DIR, "tests/fixtures/contracts.json");
const BIASES = new Set([-50, -25, 0, 25, 50]);
const WEIGHTS = new Map([
  [-50, [100, 0]],
  [-25, [75, 25]],
  [0, [50, 50]],
  [25, [25, 75]],
  [50, [0, 100]],
]);
const SIMULATED_ENDPOINT = "https://api.openai.com/v1/responses";
const REPRESENTATIVE_MAX_INPUT_TOKENS = 80000;

class CaptureInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaptureInputError";
    this.code = code;
  }
}

function usage() {
  console.log(`Usage:
  node cloudflare-backend/scripts/verify-capture-mix.mjs \
    --source-a PATH --source-b PATH --out PATH --bias -50|-25|0|25|50

PATH may be a saved QA capture JSON or a benchmark capture directory containing
metrics.json, evidence.json, and capture.jpg. A missing or failed source is
allowed only when its computed weight is zero for bias -50 or 50.
`);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) {
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
    return argv[index + 1];
  }
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function parseCli(argv) {
  if (argv.includes("--help")) {
    usage();
    process.exit(0);
  }
  const sourceA = option(argv, "--source-a");
  const sourceB = option(argv, "--source-b");
  const out = option(argv, "--out");
  const bias = Number(option(argv, "--bias"));
  if (!sourceA || !sourceB || !out || !Number.isInteger(bias) || !BIASES.has(bias))
    throw new Error("Required: --source-a PATH --source-b PATH --out PATH --bias -50|-25|0|25|50");
  return {
    sourceA: resolve(sourceA),
    sourceB: resolve(sourceB),
    out: resolve(out),
    bias,
  };
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

async function writeJson(path, value) {
  await writeFile(path, `${json(value)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorInfo(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || error?.name || "ERROR",
    message: String(error?.message || error).slice(0, 1000),
  };
}

function screenshotBuffer(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const encoded = value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  return bytes.byteLength ? bytes : null;
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.href === value;
  } catch {
    return false;
  }
}

async function loadCapture(inputPath, label, required) {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch {
    if (!required) return { label, usable: false, reason: "missing-input", input: inputPath };
    throw new CaptureInputError("CAPTURE_INPUT_MISSING", `${label}: input does not exist: ${inputPath}`);
  }

  try {
    if (inputStat.isDirectory()) {
      const metrics = JSON.parse(await readFile(join(inputPath, "metrics.json"), "utf8"));
      if (metrics.outcome !== "OK")
        throw new CaptureInputError("CAPTURE_INPUT_FAILED", `${label}: metrics.outcome is ${metrics.outcome || "missing"}`);
      const data = JSON.parse(await readFile(join(inputPath, "evidence.json"), "utf8"));
      const screenshot = await readFile(join(inputPath, "capture.jpg"));
      return usableCapture({ label, input: inputPath, kind: "benchmark-directory", data, screenshot, metrics });
    }

    const payload = JSON.parse(await readFile(inputPath, "utf8"));
    if (payload.success !== true)
      throw new CaptureInputError("CAPTURE_INPUT_FAILED", `${label}: saved result is not successful`);
    if (payload.metrics?.outcome && payload.metrics.outcome !== "OK")
      throw new CaptureInputError("CAPTURE_INPUT_FAILED", `${label}: saved result metrics.outcome is ${payload.metrics.outcome}`);
    if (!Array.isArray(payload.sources) || payload.sources.length !== 1)
      throw new CaptureInputError("CAPTURE_INPUT_SHAPE", `${label}: saved QA JSON must contain exactly one source`);
    const saved = payload.sources[0];
    return usableCapture({
      label,
      input: inputPath,
      kind: "saved-qa-json",
      data: saved.data,
      screenshot: screenshotBuffer(saved.screenshot),
      metrics: payload.metrics || null,
    });
  } catch (error) {
    if (!required && (error?.code === "ENOENT" || error instanceof CaptureInputError))
      return { label, usable: false, reason: error.code || "invalid-input", input: inputPath };
    if (error instanceof CaptureInputError) throw error;
    throw new CaptureInputError("CAPTURE_INPUT_INVALID", `${label}: ${error.message}`);
  }
}

function usableCapture({ label, input, kind, data, screenshot, metrics }) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new CaptureInputError("CAPTURE_INPUT_SHAPE", `${label}: evidence must be an object`);
  if (!validUrl(data.url))
    throw new CaptureInputError("CAPTURE_INPUT_SHAPE", `${label}: evidence.url must be an absolute HTTP(S) URL`);
  if (!screenshot?.byteLength)
    throw new CaptureInputError("CAPTURE_INPUT_SHAPE", `${label}: capture screenshot is missing or empty`);
  return {
    label,
    usable: true,
    input,
    kind,
    url: data.url,
    data,
    screenshot: screenshot.toString("base64"),
    screenshotBytes: screenshot.byteLength,
    evidenceSha256: sha256(Buffer.from(JSON.stringify(data))),
    screenshotSha256: sha256(screenshot),
    captureOutcome: metrics?.outcome || "OK",
  };
}

async function buildAnalysisModule() {
  const temp = await mkdtemp(join(tmpdir(), "design-scraper-mix-"));
  const bundlePath = join(temp, "analysis.mjs");
  await build({
    stdin: {
      contents: `
        export { analyze } from "./src/providers";
        export { config } from "./src/config";
        export { normalize } from "./src/domain/normalize";
        export { renderDocuments, renderExports } from "./src/domain/renderers";
      `,
      resolveDir: BACKEND_DIR,
      loader: "ts",
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    logLevel: "silent",
  });
  const bytes = await readFile(bundlePath);
  const module = await import(`${pathToFileURL(bundlePath).href}?sha256=${sha256(bytes)}`);
  return { temp, module, bundleSha256: sha256(bytes) };
}

function hasMeasuredName(value, prefix) {
  if (Array.isArray(value)) return value.some((item) => hasMeasuredName(item, prefix));
  if (!value || typeof value !== "object") return false;
  if (typeof value.name === "string" && value.name.startsWith(prefix)) return true;
  return Object.values(value).some((item) => hasMeasuredName(item, prefix));
}

const dimension = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i;
const measuredTypographyKinds = new Set(["heading", "body", "button", "link", "input"]);
const measuredComponentKinds = new Set(["button", "input", "card", "navigation", "footer"]);
const measuredLayoutKinds = new Set(["section", "card", "navigation", "layout", "footer"]);
const measuredComponentProperties = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color",
  "backgroundColor", "borderRadius", "border", "boxShadow", "paddingTop", "paddingRight",
  "paddingBottom", "paddingLeft",
];
const measuredSpacingProperties = [
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight",
  "marginBottom", "marginLeft", "rowGap", "columnGap",
];
const cssName = (key) => key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

function buildExpectedMeasuredValues(sources) {
  const expected = {};
  const add = (source, sample, property, value) => {
    if (typeof value !== "string" || !value) return;
    expected[`measured-${source.label.replace("_", "-")}-${sample.id}-${property}`] = value;
  };
  for (const source of sources.filter((candidate) => candidate.weight > 0)) {
    const capture = source.data.measurements;
    if (!capture || capture.version !== 1 || !Array.isArray(capture.samples)) continue;
    for (const sample of capture.samples) {
      const style = sample.styles || {};
      if (measuredTypographyKinds.has(sample.kind)) {
        add(source, sample, "font-family", style.fontFamily);
        if (dimension.test(style.fontSize || "")) add(source, sample, "font-size", style.fontSize);
        if (/^[1-9]00$/.test(style.fontWeight || "") || /^(normal|bold|lighter|bolder)$/.test(style.fontWeight || ""))
          add(source, sample, "font-weight", style.fontWeight);
        if (dimension.test(style.lineHeight || "")) add(source, sample, "line-height", style.lineHeight);
        if (dimension.test(style.letterSpacing || "")) add(source, sample, "letter-spacing", style.letterSpacing);
      }
      if (measuredComponentKinds.has(sample.kind)) {
        for (const property of measuredComponentProperties) add(source, sample, cssName(property), style[property]);
      }
      for (const property of measuredSpacingProperties) {
        const value = style[property];
        if (!dimension.test(value || "")) continue;
        const scopedPadding = property.startsWith("padding") && ["section", "card", "button"].includes(sample.kind);
        if (!scopedPadding && /^0(?:px)?$/.test(String(value))) continue;
        add(source, sample, cssName(property), value);
      }
      if (measuredLayoutKinds.has(sample.kind)) {
        for (const property of ["width", "maxWidth"])
          if (dimension.test(style[property] || "")) add(source, sample, property === "maxWidth" ? "max-width" : property, style[property]);
        for (const property of ["rowGap", "columnGap"])
          if (dimension.test(style[property] || "")) add(source, sample, cssName(property), style[property]);
      }
    }
  }
  return expected;
}

function actualMeasuredValues(value, result = {}) {
  if (Array.isArray(value)) {
    for (const item of value) actualMeasuredValues(item, result);
  } else if (value && typeof value === "object") {
    if (typeof value.name === "string" && value.name.startsWith("measured-") && typeof value.value === "string") {
      if (result[value.name] !== undefined && result[value.name] !== value.value)
        throw new Error(`Measured token has conflicting values: ${value.name}`);
      result[value.name] = value.value;
    }
    for (const item of Object.values(value)) actualMeasuredValues(item, result);
  }
  return result;
}

function expectedMeasurementMetadata(sources) {
  const counts = {};
  const locators = {};
  for (const source of sources.filter((candidate) => candidate.weight > 0)) {
    const capture = source.data.measurements;
    if (!capture || capture.version !== 1 || !Array.isArray(capture.samples)) continue;
    counts[source.label] = capture.samples.length;
    for (const sample of capture.samples) {
      locators[`measured-${source.label.replace("_", "-")}-${sample.id}`] = {
        selector: sample.selector,
        tag: sample.tag,
        kind: sample.kind,
        source: source.label,
        influence: source.weight,
      };
    }
  }
  return { counts, locators };
}

function sourceManifest(sources) {
  return sources.map(({ label, url, weight }) => ({
    label,
    url,
    weight,
    status: weight ? "analyzed" : "excluded",
  }));
}

async function main(cli, state) {
  const [weightA, weightB] = WEIGHTS.get(cli.bias);
  const [a, b] = await Promise.all([
    loadCapture(cli.sourceA, "web_1", weightA > 0),
    loadCapture(cli.sourceB, "web_2", weightB > 0),
  ]);
  if (weightA > 0 && !a.usable) throw new CaptureInputError("CAPTURE_INPUT_REQUIRED", "web_1 has positive weight but no usable capture");
  if (weightB > 0 && !b.usable) throw new CaptureInputError("CAPTURE_INPUT_REQUIRED", "web_2 has positive weight but no usable capture");

  const sources = [a, b].map((source, index) => ({
    label: source.label,
    url: source.usable ? source.url : `unavailable://web_${index + 1}`,
    weight: index === 0 ? weightA : weightB,
    data: source.usable ? source.data : {},
    ...(source.usable ? { screenshot: source.screenshot } : {}),
  }));
  const expectedManifest = sourceManifest(sources);
  state.inputManifest = expectedManifest;

  const { module, temp, bundleSha256 } = await buildAnalysisModule();
  try {
    const fixtures = JSON.parse(await readFile(FIXTURES_FILE, "utf8"));
    const fixture = fixtures.find((candidate) => candidate.bias === cli.bias);
    assert.ok(fixture, `No fixed fixture exists for bias ${cli.bias}`);
    const raw = structuredClone(fixture.raw);
    raw.evidence.sources = expectedManifest;
    raw.evidence.notes = [
      ...(raw.evidence.notes || []),
      "SIMULATED PROVIDER OUTPUT: fixture response used for integration, provenance, measurement, and export checks only; no semantic AI quality claim.",
    ];

    const fakeFetch = async (url, init) => {
      const endpoint = String(url);
      if (endpoint !== SIMULATED_ENDPOINT)
        throw new Error(`SIMULATED_UNEXPECTED_PROVIDER_ENDPOINT: ${endpoint}`);
      state.simulatedProviderCalls++;
      if (state.simulatedProviderCalls !== 1) throw new Error("SIMULATED_PROVIDER_CALL_BUDGET_EXCEEDED");
      assert.equal(init?.method, "POST");
      const request = JSON.parse(String(init?.body || "{}"));
      const imageCount = JSON.stringify(request).split('"type":"input_image"').length - 1;
      assert.equal(imageCount, sources.filter((source) => source.weight > 0).length);
      const promptText = request.input?.flatMap((item) => item.content || [])
        .filter((item) => item.type === "input_text")
        .map((item) => item.text || "")
        .join("\n") || "";
      for (const source of sources.filter((candidate) => candidate.weight > 0)) {
        assert.ok(promptText.includes(JSON.stringify(source.data)), `${source.label}: complete source text missing from provider input`);
        assert.ok(promptText.includes(source.url), `${source.label}: source URL missing from provider input`);
      }
      return Response.json({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(raw) }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      });
    };

    const config = module.config({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "SIMULATED_LOCAL_PLACEHOLDER",
      OPENAI_MODEL: "gpt-4o",
      MAX_AI_ATTEMPTS: "1",
      MAX_INPUT_TOKENS: String(REPRESENTATIVE_MAX_INPUT_TOKENS),
    });
    assert.equal(config.inputTokens, REPRESENTATIVE_MAX_INPUT_TOKENS);
    const response = await module.analyze(
      sources,
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "SIMULATED_LOCAL_PLACEHOLDER", OPENAI_MODEL: "gpt-4o" },
      config,
      AbortSignal.timeout(10_000),
      fakeFetch,
    );
    const system = module.normalize(response.raw, sources);
    assert.deepEqual(system.evidence.sources, expectedManifest);
    const expectedMeasurements = expectedMeasurementMetadata(sources);
    assert.deepEqual(system.metadata.measurement_counts || {}, expectedMeasurements.counts, "measurement counts must match capture inputs");
    assert.deepEqual(system.metadata.measurement_locators || {}, expectedMeasurements.locators, "measurement locators must match capture inputs");
    const expectedMeasuredValues = buildExpectedMeasuredValues(sources);
    const measuredValues = actualMeasuredValues(system);
    assert.deepEqual(measuredValues, expectedMeasuredValues, "measured token values must match capture inputs exactly");
    for (const source of sources) {
      const prefix = `measured-${source.label.replace("_", "-")}-`;
      assert.equal(hasMeasuredName(system, prefix), source.weight > 0, `${source.label}: measured-token weight isolation`);
    }
    const documents = module.renderDocuments(system);
    const exports = module.renderExports(system);
    assert.deepEqual(module.renderDocuments(system), documents);
    assert.deepEqual(module.renderExports(system), exports);
    assert.equal(Object.keys(documents).length + Object.keys(exports).length, 5);

    const result = {
      label: "SIMULATED",
      semanticAIQualityClaim: false,
      design_system: system,
      documents,
      exports,
      metadata: {
        mode: "SIMULATED_CAPTURE_MIX",
        provider: "openai",
        providerCalls: state.simulatedProviderCalls,
        realProviderCalls: 0,
        sourceManifest: expectedManifest,
        bias: cli.bias,
      },
    };
    await mkdir(cli.out, { recursive: true });
    await writeJson(join(cli.out, "source-manifest.json"), {
      label: "SIMULATED",
      bias: cli.bias,
      sources: [a, b].map((source) => ({
        label: source.label,
        input: source.input,
        kind: source.kind || null,
        usable: source.usable,
        reason: source.reason || null,
        url: source.url || null,
        evidenceSha256: source.evidenceSha256 || null,
        screenshotSha256: source.screenshotSha256 || null,
      })),
    });
    await writeJson(join(cli.out, "simulated-result.json"), result);
    await writeFile(join(cli.out, "SIMULATED-DESIGN.md"), documents.extended);
    await writeFile(join(cli.out, "SIMULATED-DESIGN.compact.md"), documents.compact);
    await writeFile(join(cli.out, "SIMULATED-design-variables.css"), exports.css_variables);
    await writeFile(join(cli.out, "SIMULATED-tailwind-theme.css"), exports.tailwind);
    await writeFile(join(cli.out, "SIMULATED-design-tokens.json"), exports.design_tokens);
    const report = {
      status: "OK",
      label: "SIMULATED",
      semanticAIQualityClaim: false,
      bias: cli.bias,
      weights: { web_1: weightA, web_2: weightB },
      sourceManifest: expectedManifest,
      sourceInputs: [a, b].map(({ label, input, usable, reason, captureOutcome }) => ({ label, input, usable, reason: reason || null, captureOutcome: captureOutcome || null })),
      provenanceVerified: true,
      measuredTokens: Object.fromEntries(sources.map((source) => [source.label, hasMeasuredName(system, `measured-${source.label.replace("_", "-")}-`)])),
      sourceTextVerified: true,
      measuredValuesVerified: true,
      measuredTokenCounts: {
        expected: Object.keys(expectedMeasuredValues).length,
        actual: Object.keys(measuredValues).length,
      },
      representativeMaxInputTokens: config.inputTokens,
      formatCount: 5,
      formats: [...Object.keys(documents), ...Object.keys(exports)],
      simulatedProviderCalls: state.simulatedProviderCalls,
      realProviderCalls: 0,
      analysisUsage: response.usage,
      analysisBundleSha256: bundleSha256,
      note: "Integration, provenance, source-weight isolation, measurements, and export consistency only; no semantic AI quality claim.",
    };
    await writeJson(join(cli.out, "report.json"), report);
    console.log(json(report));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

let cli;
const state = { simulatedProviderCalls: 0, inputManifest: null };
try {
  cli = parseCli(process.argv.slice(2));
  await main(cli, state);
} catch (error) {
  const failure = {
    status: "ERROR",
    label: "SIMULATED",
    validationFailedBeforeProvider: state.simulatedProviderCalls === 0,
    simulatedProviderCalls: state.simulatedProviderCalls,
    realProviderCalls: 0,
    sourceManifest: state.inputManifest,
    error: errorInfo(error),
  };
  if (cli?.out) {
    await mkdir(cli.out, { recursive: true });
    await writeJson(join(cli.out, "report.json"), failure);
  }
  console.error(json(failure));
  process.exitCode = 1;
}
