import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/contracts.json";
import { normalize, type Source } from "../src/domain/normalize";
import type { DesignSystem } from "../src/domain/types";
import { renderDocuments, renderExports } from "../src/domain/renderers";

function setup() {
  const fixture = structuredClone(fixtures[0]);
  const raw = fixture.raw as DesignSystem;
  const sources = fixture.sources as Source[];
  sources[0].data = {
    colors: [{ color: "rgb(83, 58, 253)", count: 3 }],
    measurements: { version: 1, viewport: { width: 1440, height: 900 }, samples: [
      { id: "button-1", kind: "button", tag: "button", selector: "html > body > button",
        styles: { backgroundColor: "rgb(83, 58, 253)", color: "rgb(255, 255, 255)" } },
      { id: "section-1", kind: "section", tag: "main", selector: "html > body > main",
        styles: { width: "1440px", maxWidth: "none" } },
    ] },
  };
  // Sanitized value pair observed in real QA; no site-specific runtime policy.
  Object.assign(raw.colors.brand[0], { value: "#533a01", confidence: 0.95 });
  Object.assign(raw.layout.values[0], { name: "content-max-width", value: "1440px", role: "Maximum viewport desktop container width", confidence: 0.95 });
  return { raw, sources };
}

it("retains unmatched proposals with lower confidence and token-scoped gaps, preserving measured values", () => {
  const { raw, sources } = setup();
  const result = normalize(JSON.stringify(raw), sources);
  expect(result.colors.brand[0]).toMatchObject({ value: "#533a01", confidence: 0.5, status: "inferred" });
  expect(result.layout.values[0]).toMatchObject({ value: "1440px", confidence: 0.5, status: "inferred" });
  expect(result.known_gaps).toContainEqual(expect.objectContaining({ code: "color-value-unverified", source: ["web_1"],
    message: expect.stringContaining("colors.brand.brand-primary (#533a01)") }));
  expect(result.known_gaps).toContainEqual(expect.objectContaining({ code: "viewport-maximum-unverified", source: ["web_1"],
    message: expect.stringContaining("does not establish a global layout maximum") }));
  expect(result.components.find(component => component.name === "measured-web-1-button-1")?.values)
    .toContainEqual(expect.objectContaining({ value: "rgb(83, 58, 253)", confidence: 1, status: "detected" }));
  expect(result.layout.container).toContainEqual(expect.objectContaining({ name: "measured-web-1-section-1-width", value: "1440px", confidence: 1, status: "detected" }));
  for (const document of Object.values(renderDocuments(result))) {
    expect(document).toContain("color-value-unverified");
    expect(document).toContain("not evidence that the color is absent");
  }
  expect(JSON.stringify(renderExports(result))).toContain("#533a01");
});

describe("supported color representations", () => {
  it.each(["#533afd", "#533AFDff", "rgb(83 58 253 / 100%)", "rgba(83, 58, 253, 1)"])("matches %s to observed RGB without reducing confidence", value => {
    const { raw, sources } = setup(); raw.colors.brand[0].value = value;
    const result = normalize(JSON.stringify(raw), sources);
    expect(result.colors.brand[0]).toMatchObject({ value, confidence: 0.95 });
    expect(result.known_gaps.some(gap => gap.code === "color-value-unverified" && gap.message.startsWith("colors.brand.brand-primary "))).toBe(false);
  });
  it("accepts color evidence from direct captured CSS variables and samples", () => {
    const { raw, sources } = setup(); sources[0].data.cssVariables = { "--brand-color": "#533a01" };
    const result = normalize(JSON.stringify(raw), sources);
    expect(result.colors.brand[0].confidence).toBe(0.95);
    raw.colors.brand[0].value = "#fff";
    expect(normalize(JSON.stringify(raw), sources).colors.brand[0].confidence).toBe(0.95);
  });
  it("does not equate opaque and translucent colors or round alpha into a match", () => {
    const { raw, sources } = setup(); sources[0].data.colors = [{ color: "rgba(83, 58, 253, 0.5)", count: 1 }];
    (sources[0].data.measurements as { samples: unknown[] }).samples = [];
    raw.colors.brand[0].value = "#533afd80";
    expect(normalize(JSON.stringify(raw), sources).colors.brand[0].confidence).toBe(0.5);
    raw.colors.brand[0].value = "#533afd";
    expect(normalize(JSON.stringify(raw), sources).colors.brand[0].confidence).toBe(0.5);
    raw.colors.brand[0].value = "rgb(83 58 253 / 50%)";
    expect(normalize(JSON.stringify(raw), sources).colors.brand[0].confidence).toBe(0.95);
  });
});

it("does not raise existing low confidence or change interpreted status", () => {
  const { raw, sources } = setup(); Object.assign(raw.colors.brand[0], { confidence: 0.3, status: "interpreted" });
  expect(normalize(JSON.stringify(raw), sources).colors.brand[0]).toMatchObject({ value: "#533a01", confidence: 0.3, status: "interpreted" });
});

it("keeps uncertainty diagnostics bounded without skipping confidence qualification", () => {
  const { raw, sources } = setup();
  raw.colors.brand = Array.from({ length: 40 }, (_, index) => ({ ...raw.colors.brand[0], name: `proposal-${index}` }));
  const result = normalize(JSON.stringify(raw), sources);
  expect(result.colors.brand.every(token => token.confidence === 0.5)).toBe(true);
  expect(result.known_gaps.filter(gap => gap.code === "color-value-unverified")).toHaveLength(16);
  expect(result.known_gaps.filter(gap => gap.code === "color-value-unverified-additional")).toHaveLength(1);
});

it.each(["computed", "css-variable"])("does not flag a matching captured %s maximum", evidence => {
  const { raw, sources } = setup();
  if (evidence === "computed") (sources[0].data.measurements as { samples: { styles: Record<string, string> }[] }).samples[1].styles.maxWidth = "1440px";
  else sources[0].data.cssVariables = { "--container-max-width": "1440px" };
  const result = normalize(JSON.stringify(raw), sources);
  expect(result.layout.values[0].confidence).toBe(0.95);
  expect(result.known_gaps.some(gap => gap.code === "viewport-maximum-unverified")).toBe(false);
});

it("does not treat a plain observed width as a claimed global maximum", () => {
  const { raw, sources } = setup(); Object.assign(raw.layout.values[0], { name: "sample-width", role: "Sampled main element width" });
  expect(normalize(JSON.stringify(raw), sources).layout.values[0].confidence).toBe(0.95);
});

it.each([-50, 0, 50])("preserves intentional mix proposals including excluded-source bias %s", bias => {
  const fixture = structuredClone(fixtures.find(fixture => fixture.bias === bias)!);
  const sources = fixture.sources as Source[];
  for (const source of sources) source.data = setup().sources[0].data;
  const result = normalize(JSON.stringify(fixture.raw), sources);
  expect(result.colors.brand[0].value).toBe(fixture.raw.colors.brand[0].value);
  expect(result.colors.brand[0].confidence).toBe(fixture.raw.colors.brand[0].confidence);
  expect(result.known_gaps.some(gap => ["color-value-unverified", "viewport-maximum-unverified"].includes(gap.code))).toBe(false);
});

it("preserves historical fixed fixtures without measured capture context", () => {
  for (const fixture of fixtures) expect(normalize(JSON.stringify(fixture.raw), fixture.sources as Source[])).toEqual(fixture.normalized);
});
