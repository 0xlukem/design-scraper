import { describe, it, expect } from "vitest";
import fixtures from "./fixtures/contracts.json";
import {
  normalize,
  type Source,
  weightedEvidence,
} from "../src/domain/normalize";
import { renderDocuments, renderExports } from "../src/domain/renderers";
import { parseInput } from "../src/index";
it("accepts fenced JSON without losing evidence gaps", () => {
  const f = fixtures[0];
  const s = normalize("```json\n" + JSON.stringify(f.raw) + "\n```", f.sources as Source[]);
  expect(s).toEqual(f.normalized);
});
it("adds source background-404 evidence even when the provider omits the warning", () => {
  const f = structuredClone(fixtures[0]);
  const sources = f.sources as Source[];
  sources[0].data.capture = { missing_background_images_count: 1 };
  const result = normalize(JSON.stringify(f.raw), sources);
  expect(result.known_gaps).toContainEqual(expect.objectContaining({
    code: "background-image-not-found", source: [sources[0].label],
  }));
  expect(JSON.stringify(renderDocuments(result))).toContain("HTTP 404");
});
it("preserves incomplete async-script evidence in documents when the provider omits it", () => {
  const f = structuredClone(fixtures[0]);
  const sources = f.sources as Source[];
  sources[0].data.capture = { failed_async_scripts_count: 1 };
  const result = normalize(JSON.stringify(f.raw), sources);
  expect(result.known_gaps).toContainEqual(expect.objectContaining({
    code: "async-script-unavailable", source: [sources[0].label],
  }));
  for (const document of Object.values(renderDocuments(result))) {
    expect(document).toContain("async-script-unavailable");
    expect(document).toContain("were not verified");
  }
});
it("preserves the multi-frame limitation of a section capture", () => {
  const f = structuredClone(fixtures[0]);
  const sources = f.sources as Source[];
  sources[0].data.capture = { method: "viewport-sections" };
  expect(normalize(JSON.stringify(f.raw), sources).known_gaps).toContainEqual(
    expect.objectContaining({ code: "capture-sections", source: [sources[0].label] }));
});
it("carries deliberate branding exclusions into documents without calling them safety failures", () => {
  const f = structuredClone(fixtures[0]);
  const sources = f.sources as Source[];
  sources[0].data.capture = { method: "viewport-sections", overlay_policy: "sticky-in-flow-fixed-once",
    media_policy: "static-branding", excluded_media_resources: 2, excluded_prefetch_resources: 4,
    blocked_subresources: 0 };
  const system = normalize(JSON.stringify(f.raw), sources);
  expect(system.known_gaps).toContainEqual(expect.objectContaining({ code: "media-content-excluded" }));
  expect(system.known_gaps).toContainEqual(expect.objectContaining({ code: "navigation-prefetch-excluded" }));
  expect(system.known_gaps.some(gap => gap.code === "blocked-subresources")).toBe(false);
  for (const document of Object.values(renderDocuments(system))) {
    expect(document).toContain("media-content-excluded");
    expect(document).toContain("navigation-prefetch-excluded");
  }
});
it.each(["auto", "24px 12px", "calc(2rem + 1px)"])("rejects unsupported dimension token %s", value => {
  const f = structuredClone(fixtures[0]);
  f.raw.spacing.tokens[0].value = value;
  expect(() => normalize(JSON.stringify(f.raw), f.sources as Source[])).toThrow();
});
it.each([-50, -25, 0, 25, 50])("preserves admitted mix weights for bias %s", bias => {
  expect(parseInput("/api/mix", { url_1: "https://one.example", url_2: "https://two.example", bias }).map(s => s.weight))
    .toEqual([50 - bias, 50 + bias]);
});
for (const f of fixtures)
  describe(`Output contract bias=${f.bias}`, () => {
    it("normalizes evidence and renders all formats byte-for-byte", () => {
      const s = normalize(JSON.stringify(f.raw), f.sources as Source[]);
      expect(s).toEqual(f.normalized);
      expect(renderDocuments(s)).toEqual(f.documents);
      expect(renderExports(s)).toEqual(f.exports);
    });
  });
it.each(["not-json", "{}", "[]", '{"colors":[]}'])(
  "rejects malformed model: %s",
  (raw) =>
    expect(() => normalize(raw, fixtures[0].sources as Source[])).toThrow(),
);
it("rejects invented provenance and changed influence", () => {
  const p = structuredClone(fixtures[0].raw);
  p.colors.brand[0].source = ["web_2"];
  expect(() =>
    normalize(JSON.stringify(p), fixtures[0].sources as Source[]),
  ).toThrow();
  const q = structuredClone(fixtures[0].raw);
  q.evidence.sources[0].weight = 50;
  expect(() =>
    normalize(JSON.stringify(q), fixtures[0].sources as Source[]),
  ).toThrow();
});
it.each(["not-a-color", "red; color:blue", "</style>"])(
  "rejects invalid colors %s",
  (v) => {
    const p = structuredClone(fixtures[0].raw);
    p.colors.brand[0].value = v;
    expect(() =>
      normalize(JSON.stringify(p), fixtures[0].sources as Source[]),
    ).toThrow();
  },
);
it.each(["12px", "0px 12px", "8px 16px 8px", "1rem 2rem 1rem 2rem"])(
  "accepts padding shorthand %s",
  (v) => {
    const p = structuredClone(fixtures[0].raw);
    p.spacing.button_padding = [{ ...p.spacing.tokens[0], name: "button-padding", value: v }];
    expect(normalize(JSON.stringify(p), fixtures[0].sources as Source[]).spacing.button_padding[0].value).toBe(v);
  },
);
it.each(["1px 2px 3px 4px 5px", "auto", "0px 12px;"])("rejects padding %s", (v) => {
  const p = structuredClone(fixtures[0].raw);
  p.spacing.button_padding = [{ ...p.spacing.tokens[0], name: "button-padding", value: v }];
  expect(() => normalize(JSON.stringify(p), fixtures[0].sources as Source[])).toThrow(
    expect.objectContaining({ validationReason: "dimension_value" }),
  );
});
it("keeps spacing tokens to a single length", () => {
  const p = structuredClone(fixtures[0].raw);
  p.spacing.tokens[0].value = "0px 12px";
  expect(() => normalize(JSON.stringify(p), fixtures[0].sources as Source[])).toThrow(
    expect.objectContaining({ validationDetail: { path: "spacing.tokens[0]", value: "0px 12px" } }),
  );
});
it("resolves a color variable through captured declarations and records it", () => {
  const p = structuredClone(fixtures[0].raw);
  p.colors.accent[0].value = "var(--brand-accent)";
  const sources = structuredClone(fixtures[0].sources) as Source[];
  sources[0].data = { ...sources[0].data, cssVariables: { "--brand-accent": "var(--blue-700)", "--blue-700": "#1f6feb" } };
  const s = normalize(JSON.stringify(p), sources);
  expect(s.colors.accent[0].value).toBe("#1f6feb");
  expect(s.known_gaps).toContainEqual(expect.objectContaining({ code: "color-variables-resolved", message: expect.stringContaining("--brand-accent → #1f6feb") }));
});
it("uses the var() fallback when the variable was not captured", () => {
  const p = structuredClone(fixtures[0].raw);
  p.colors.accent[0].value = "var(--missing, rgb(1, 2, 3))";
  expect(normalize(JSON.stringify(p), fixtures[0].sources as Source[]).colors.accent[0].value).toBe("rgb(1, 2, 3)");
});
it.each(["var(--missing)", "var(--loop)"])("fails %s with a retryable reason", (v) => {
  const p = structuredClone(fixtures[0].raw);
  p.colors.accent[0].value = v;
  const sources = structuredClone(fixtures[0].sources) as Source[];
  sources[0].data = { ...sources[0].data, cssVariables: { "--loop": "var(--loop)" } };
  expect(() => normalize(JSON.stringify(p), sources)).toThrow(
    expect.objectContaining({ validationReason: "unresolved_color_variable", validationDetail: { path: "colors.accent[0]", value: v } }),
  );
});
it("names the rejected color for operator logs", () => {
  const p = structuredClone(fixtures[0].raw);
  p.colors.accent[0].value = "#accent";
  try {
    normalize(JSON.stringify(p), fixtures[0].sources as Source[]);
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({
      code: "AI_FAILED",
      validationReason: "color_value",
      validationDetail: { path: "colors.accent[0]", value: "#accent" },
    });
  }
});
it("validates source requests, defaults and exclusions", () => {
  expect(
    parseInput("/api/mix", {
      url_1: "https://example.com",
      url_2: "https://example-two.com",
      bias: 50,
    }).map((s) => s.weight),
  ).toEqual([0, 100]);
  expect(() =>
    parseInput("/api/mix", {
      url_1: "https://example.com",
      url_2: "https://example.com/",
    }),
  ).toThrow();
  expect(() =>
    parseInput("/api/analyze", {
      url: "https://example.com",
      api_key: "secret",
    }),
  ).toThrow();
  expect(() =>
    parseInput("/api/mix", {
      url_1: "https://example.com",
      url_2: "https://example-two.com",
      bias: 12,
    }),
  ).toThrow();
});
it("normalizes counts within each source before applying bias", () => {
  const sources = structuredClone(fixtures[2].sources) as Source[];
  sources[0].data = { colors: [{ color: "#abc", count: 20 }] };
  sources[1].data = { colors: [{ color: "#def", count: 2000 }] };
  expect(weightedEvidence(sources).ranked_signals.colors).toMatchObject([
    { source: "web_1", weighted_score: 75 },
    { source: "web_2", weighted_score: 25 },
  ]);
});
import classifierFixture from "./fixtures/classifier.json";
import { classifyVariables } from "../src/domain/classify";
it("preserves the CSS-variable classification contract", () =>
  expect(classifyVariables(classifierFixture.raw)).toEqual(
    classifierFixture.expected,
  ));
