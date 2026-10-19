import { preserveMeasurements, omitNullStateProperties } from "./measurements";
import { cssLikeColor } from "./css-color";
import validate from "./validate.js";
import type { DesignSystem, TokenValue } from "./types";
import { ApiError } from "../errors";
export interface Source {
  label: "web_1" | "web_2";
  url: string;
  weight: number;
  screenshot?: string;
  data: Record<string, unknown>;
}
const fail = (reason = "shape") => {
  const error = new ApiError(
    "AI_FAILED",
    "The AI provider returned an invalid design system.",
    502,
    true,
  );
  Object.assign(error, { validationReason: reason });
  throw error;
};
const dimension =
  /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i;

// Compare common CSS color representations without changing their stored values.
// Other syntax requires a literal match; a miss is uncertainty, not absence.
function colorEvidenceKey(value: unknown): string | null {
  if (typeof value !== "string" || !cssLikeColor(value.trim())) return null;
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  const named: Record<string, string> = {
    black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080", white: "#ffffff",
    maroon: "#800000", red: "#ff0000", purple: "#800080", fuchsia: "#ff00ff", green: "#008000",
    lime: "#00ff00", olive: "#808000", yellow: "#ffff00", navy: "#000080", blue: "#0000ff",
    teal: "#008080", aqua: "#00ffff", transparent: "#00000000",
  };
  const hex = (Object.hasOwn(named, text) ? named[text] : text).match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/);
  if (hex) {
    const digits = hex[1].length < 5 ? [...hex[1]].map(digit => digit + digit).join("") : hex[1];
    return JSON.stringify([0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16))
      .concat(digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1));
  }
  const rgb = text.match(/^rgba?\(([^()]*)\)$/);
  if (rgb) {
    const parts = rgb[1].trim().split(/[\s,/]+/);
    if ((parts.length === 3 || parts.length === 4) && parts.every(part => /^\d*\.?\d+%?$/.test(part))) {
      const channels = parts.slice(0, 3).map(part => part.endsWith("%") ? parseFloat(part) / 100 * 255 : Number(part));
      const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : Number(parts[3]);
      if (channels.every(channel => channel >= 0 && channel <= 255) && alpha >= 0 && alpha <= 1)
        return JSON.stringify([...channels, alpha]);
    }
  }
  return text.replace(/\s*([(),/])\s*/g, "$1");
}

/** A single-site extraction should distinguish unmatched proposals from strong
 * measured evidence. Mixed systems intentionally propose new values. */
function qualifySingleSourceInferences(system: DesignSystem, sources: Source[]) {
  if (sources.length !== 1 || !sources[0].weight) return;
  const source = sources[0];
  const measurements = source.data.measurements as {
    version?: number; viewport?: { width?: number }; samples?: { styles: Record<string, string> }[];
  } | undefined;
  if (measurements?.version !== 1) return;
  // preserveMeasurements has already validated the shape of these samples.
  const samples = measurements.samples!;
  const colors = new Set<string>();
  const collectColor = (value: unknown) => {
    const key = colorEvidenceKey(value);
    if (key) colors.add(key);
    if (typeof value === "string") for (const match of value.matchAll(/#[\da-f]{3,8}\b|rgba?\([^()]*\)/gi)) {
      const embedded = colorEvidenceKey(match[0]);
      if (embedded) colors.add(embedded);
    }
  };
  const collectStyles = (styles: unknown) => {
    if (!styles || typeof styles !== "object") return;
    const values = styles as Record<string, unknown>;
    for (const key of ["color", "backgroundColor", "borderColor", "backgroundImage", "border", "boxShadow", "fill", "stroke"])
      collectColor(values[key]);
  };
  for (const item of Array.isArray(source.data.colors) ? source.data.colors : []) collectColor(item?.color);
  for (const value of Object.values(source.data.cssVariables || {})) collectColor(value);
  collectStyles(source.data.bodyStyles);
  for (const item of Array.isArray(source.data.componentsSample) ? source.data.componentsSample : []) collectStyles(item);
  for (const sample of samples) collectStyles(sample.styles);

  const flagged = new Map<string, number>();
  const flag = (token: TokenValue, path: string, code: string, explanation: string) => {
    token.confidence = Math.min(token.confidence, 0.5);
    const count = (flagged.get(code) || 0) + 1;
    flagged.set(code, count);
    // Keep diagnostics bounded even if a provider fills every token array.
    if (count > 16) {
      const extraCode = `${code}-additional`;
      const message = `${count - 16} additional proposals failed the same bounded evidence match. Their values and inference status are retained, with confidence capped at 0.5.`;
      const gap = system.known_gaps.find(gap => gap.code === extraCode && gap.source.join() === source.label);
      if (gap) gap.message = message;
      else system.known_gaps.push({ code: extraCode, message, source: [source.label] });
      return;
    }
    const message = `${path}.${token.name.slice(0, 120)} (${String(token.value).slice(0, 120)}): ${explanation}`;
    if (!system.known_gaps.some(gap => gap.code === code && gap.message === message && gap.source.join() === source.label))
      system.known_gaps.push({ code, message, source: [source.label] });
  };
  for (const [path, tokens] of [...Object.entries(system.colors).map(([group, tokens]) => [`colors.${group}`, tokens] as const),
    ["surfaces.levels", system.surfaces.levels] as const]) {
    for (const token of tokens) if (token.status !== "detected" && !colors.has(colorEvidenceKey(token.value)!))
      flag(token, path, "color-value-unverified", "No match in the bounded captured palette, CSS values or samples. This is not evidence that the color is absent. Its proposed value and inference status remain; confidence is capped at 0.5.");
  }
  const px = (value: unknown) => typeof value === "string" && /^\d+(?:\.\d+)?px$/i.test(value.trim()) ? parseFloat(value) : null;
  const claimsMaximum = (text: string) => /\bmax(?:imum)?(?:\s+\w+){0,4}\s+width\b/i.test(text.replace(/[-_.]/g, " "));
  const maxima = new Set(samples.map(sample => px(sample.styles.maxWidth)).filter(value => value !== null));
  for (const [name, value] of Object.entries(source.data.cssVariables || {}))
    if (claimsMaximum(name) && px(value) !== null) maxima.add(px(value)!);
  const viewport = measurements.viewport?.width;
  if (!Number.isFinite(viewport) || !viewport || maxima.has(viewport)) return;
  for (const [path, tokens] of [["layout.values", system.layout.values], ["layout.container", system.layout.container]] as const)
    for (const token of tokens) if (token.status !== "detected" && px(token.value) === viewport && claimsMaximum(`${token.name} ${token.role}`))
      flag(token, path, "viewport-maximum-unverified", "Equals the captured viewport width, without a matching computed max-width or named CSS maximum. A viewport measurement does not establish a global layout maximum. The proposed value remains; confidence is capped at 0.5.");
}

export function normalize(raw: string, sources: Source[]): DesignSystem {
  let p: unknown;
  const stripped = raw
    .trim()
    .replace(/^```[^\n]*\n/, "")
    .replace(/\n```$/, "");
  try {
    p = JSON.parse(stripped);
  } catch {
    try {
      p = JSON.parse(
        stripped.slice(stripped.indexOf("{"), stripped.lastIndexOf("}") + 1),
      );
    } catch {
      fail();
    }
  }
  function visit(v: unknown, depth = 0) {
    if (depth > 30) fail();
    if (Array.isArray(v)) {
      if (v.length > 500) fail();
      v.forEach((x) => visit(x, depth + 1));
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.source === "string") o.source = [o.source];
      for (const [k, x] of Object.entries(o)) {
        if (k === "name" && "role" in o && typeof x === "string") {
          o.name = x.trim();
          if (!/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/i.test(x.trim())) fail("token_name");
        }
        if (k === "role" && typeof x === "string") {
          if (!x.trim()) fail("empty_role");
          o.role = x.trim();
        }
        if (k === "source" && Array.isArray(x)) {
          if ("role" in o && !x.length) fail("empty_source");
          if (
            x.some(
              (y) =>
                typeof y !== "string" ||
                !y.trim() ||
                !sources.some(
                  (s) =>
                    s.label === y.trim() && (!("role" in o) || s.weight > 0),
                ),
            )
          )
            fail("source_reference");
          o.source = x.map((y) => (y as string).trim());
        }
        visit(x, depth + 1);
      }
    }
  }
  visit(p);
  const omittedStateProperties = omitNullStateProperties(p, sources);
  if (!validate(p)) fail("schema");
  const s = p as DesignSystem;
  if (
    s.evidence.sources.length !== sources.length ||
    sources.some(
      (source) =>
        !s.evidence.sources.some(
          (e) =>
            e.label === source.label &&
            e.url === source.url &&
            e.weight === source.weight &&
            e.status === (source.weight ? "analyzed" : "excluded"),
        ),
    )
  )
    fail("source_manifest");
  const check = (items: Array<{ value: unknown }>, rule: "color" | RegExp) =>
    items.forEach((t) => {
      if (typeof t.value !== "string" || !(rule === "color" ? cssLikeColor(t.value.trim()) : rule.test(t.value.trim()))) fail(rule === "color" ? "color_value" : "dimension_value");
      t.value = (t.value as string).trim();
    });
  for (const items of Object.values(s.colors)) check(items, "color");
  check(s.surfaces.levels, "color");
  for (const items of [
    s.spacing.tokens,
    s.spacing.section_padding,
    s.spacing.card_padding,
    s.spacing.button_padding,
    s.shapes.radii,
    s.responsive.touch_targets,
    ...s.typography.scale.map((t) =>
      [t.size, t.line_height, t.letter_spacing].filter((t) => t !== null),
    ),
  ])
    check(items, dimension);
  if (s.spacing.base_unit) check([s.spacing.base_unit], dimension);
  for (const t of s.typography.scale) {
    const w = t.weight?.value;
    if (
      w !== undefined &&
      !(
        (Number(w) >= 100 && Number(w) <= 900 && Number(w) % 100 === 0) ||
        ["normal", "bold", "lighter", "bolder"].includes(
          String(w).toLowerCase(),
        )
      )
    )
      fail();
  }
  for (const t of s.elevation.tokens) {
    if (!t.value.trim()) fail();
    t.value = t.value.trim();
  }
  const add = (code: string, message: string, label: string) => {
    if (
      !s.known_gaps.some((g) => g.code === code && g.source.join(",") === label)
    )
      s.known_gaps.push({ code, message, source: [label] });
  };
  for (const src of sources) {
    if (!src.weight) {
      add(
        "excluded-source",
        "This source was excluded by the blend weight and was not scraped.",
        src.label,
      );
      continue;
    }
    for (const [key, code, message] of [
      [
        "cssVariables",
        "css-variables-unavailable",
        "No accessible CSS custom properties were captured from this source.",
      ],
      [
        "breakpoints",
        "responsive-evidence-limited",
        "No responsive media-query evidence was captured from this source.",
      ],
      [
        "componentsSample",
        "component-evidence-limited",
        "No component samples were captured from this source.",
      ],
    ]) {
      const x = src.data[key];
      if (!x || (typeof x === "object" && Object.keys(x).length === 0))
        add(code, message, src.label);
    }
    const capture = src.data.capture as Record<string, unknown> | undefined;
    if (Number(capture?.failed_async_scripts_count) > 0)
      add("async-script-unavailable", "One or more asynchronous scripts failed to load. The capture retains observed, styled page content only; script-dependent content, hydration and interactive behavior may be missing and were not verified.", src.label);
    if (Number(capture?.missing_background_images_count) > 0)
      add("background-image-not-found", "One or more CSS background images returned HTTP 404 at the source. They remain absent; available background colors and gradients are preserved. The missing images provide no visual evidence.", src.label);
    if (capture?.media_policy === "static-branding")
      add("media-content-excluded", "Capture targets static branding: media downloads and playback are excluded. Existing video boxes and available posters are retained; video frames, motion and media-dependent content are not evidence of the design system.", src.label);
    if (Number(capture?.excluded_prefetch_resources) > 0)
      add("navigation-prefetch-excluded", "Speculative requests for future navigation were excluded; the current page's ordinary rendering resources remain required.", src.label);
    if (capture?.method === "viewport-sections")
      add("capture-sections", capture.overlay_policy === "sticky-in-flow-fixed-once"
        ? capture.media_policy === "static-branding"
          ? "The regional image combines viewport photographs taken at different times. Sticky elements are shown in document flow and fixed overlays at most once; original styles are restored before measurement. CSS transitions are completed for photographs; script-driven animation states can differ between sections. Video content is excluded."
          : "The regional image combines viewport photographs taken at different times. Sticky elements are shown in document flow and fixed overlays at most once; original styles are restored before measurement. CSS transitions are completed for photographs, but video and script-driven animation states can differ between sections."
        : "The regional image combines multiple viewport photographs taken at different times. Animation values and the appearance or position of fixed and sticky elements may differ between sections.", src.label);
    if ((src.data.extraction as { truncated?: boolean } | undefined)?.truncated)
      add("element-evidence-sampled", "The captured region exceeded the element inspection limit; computed-style evidence is a bounded sample.", src.label);
    if (Number(capture?.css_evidence_omitted) > 0)
      add("css-evidence-sampled", "CSS custom properties and responsive rules are a bounded sample; computed styles describe the captured region.", src.label);
    if (capture?.animations_disabled)
      add("capture-static-state", "The capture covers the initial page region with CSS animations disabled for the screenshot; later interactions and motion states were not observed.", src.label);
    if (Number(capture?.excluded_streaming_resources) > 0)
      add("streaming-resources-excluded", "Streaming media and live connections were excluded; their content and states were not observed.", src.label);
    if (capture?.height_truncated)
      add(
        "capture-height-truncated",
        "The page exceeded the screenshot height limit; lower-page evidence may be missing.",
        src.label,
      );
    if (Number(capture?.blocked_subresources) > 0)
      add(
        "blocked-subresources",
        "Some subresources were blocked by public-network safety validation.",
        src.label,
      );
    if (capture?.request_limit_reached)
      add(
        "request-limit-reached",
        "The scraper reached its network request limit; some evidence may be missing.",
        src.label,
      );
  }
  delete s.metadata.measurements_version;
  delete s.metadata.measurement_counts;
  delete s.metadata.measurement_scope;
  delete s.metadata.measurement_locators;
  if (omittedStateProperties) s.known_gaps.push({
    code: 'model-state-properties-absent',
    message: `The provider returned ${omittedStateProperties} null state-property entries. They were omitted and the affected states are not verified; no interaction measurements were invented.`,
    source: sources.filter(s => s.weight > 0).map(s => s.label),
  });
  preserveMeasurements(s, sources);
  qualifySingleSourceInferences(s, sources);
  if (!validate(s)) fail("measurement_schema");
  return s;
}
export function weightedEvidence(sources: Source[]) {
  const keys: Record<string, string> = {
    colors: "color",
    fonts: "font",
    fontSizes: "size",
    fontWeights: "weight",
    lineHeights: "lineHeight",
    letterSpacings: "letterSpacing",
    spacing: "space",
    borderRadius: "radius",
    shadows: "shadow",
  };
  const ranked: Record<string, unknown[]> = {};
  for (const [field, key] of Object.entries(keys))
    ranked[field] = sources
      .flatMap((s) => {
        const items = (s.data[field] || []) as Record<string, unknown>[];
        const total = items.reduce(
          (sum, x) => sum + Math.max(Number(x.count) || 0, 0),
          0,
        );
        return total && s.weight
          ? items.map((x) => ({
              value: String(x[key]),
              source: s.label,
              source_weight: s.weight,
              weighted_score: Number(
                ((Number(x.count) / total) * s.weight).toFixed(6),
              ),
              field,
            }))
          : [];
      })
      .sort((a, b) => b.weighted_score - a.weighted_score)
      .slice(0, 24);
  const winners = new Map<
    string,
    {
      group: string;
      name: string;
      value: unknown;
      source: string;
      source_weight: number;
    }
  >();
  for (const source of sources) {
    if (!source.weight) continue;
    for (const [group, tokens] of Object.entries(
      source.data.token_candidates || {},
    ))
      for (const [name, value] of Object.entries(
        tokens as Record<string, unknown>,
      )) {
        const key = group + ":" + name;
        const prior = winners.get(key);
        if (!prior || source.weight > prior.source_weight)
          winners.set(key, {
            group,
            name,
            value,
            source: source.label,
            source_weight: source.weight,
          });
      }
  }
  return {
    ranked_signals: ranked,
    token_winners: [...winners.values()].sort(
      (a, b) =>
        b.source_weight - a.source_weight ||
        a.group.localeCompare(b.group) ||
        a.name.localeCompare(b.name),
    ),
    manifest: sources.map(({ label, url, weight }) => ({ label, url, weight })),
  };
}
