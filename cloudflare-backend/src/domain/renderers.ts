import {pythonFixed} from "./numbers";
import { explainEmptySections } from "./document-completeness";
import type { DesignSystem, TokenValue, TypographySpec } from "./types";
const py = (v: unknown): string =>
  v === null
    ? "None"
    : v === true
      ? "True"
      : v === false
        ? "False"
        : Array.isArray(v)
          ? `[${v.map((x) => (typeof x === "string" ? `'${x}'` : py(x))).join(", ")}]`
          : typeof v === "object"
            ? `{${Object.entries(v as object)
                .map(
                  ([k, x]) =>
                    `'${k}': ${typeof x === "string" ? `'${x}'` : py(x)}`,
                )
                .join(", ")}}`
            : String(v);
const value = (v: unknown) => (Array.isArray(v) ? v.map(py).join(", ") : py(v));
const bullets = (items: TokenValue[], compact = false) =>
  items.map(
    (t) =>
      `- \`${t.name}\`: ${value(t.value)} — ${t.role}${compact ? "" : ` (${t.status}, confidence ${pythonFixed(t.confidence, 2)}; source: ${t.source.join(", ")})`}`,
  );
const text = (items: string[]) => items.map((t) => `- ${t}`);
const table = (items: TokenValue[]) => [
  "| Name | Value | Role | Evidence |",
  "| --- | --- | --- | --- |",
  ...items.map(
    (t) =>
      `| \`${t.name}\` | \`${value(t.value)}\` | ${t.role} | ${t.status}; ${pythonFixed(t.confidence, 2)}; ${t.source.join(", ")} |`,
  ),
];
const group = (heading: string, items: TokenValue[], compact = false) => [
  `### ${heading}`,
  "",
  ...bullets(items, compact),
  "",
];
function typography(s: DesignSystem, compact = false): string[] {
  return [
    "## Tokens — Typography",
    "",
    ...group("Families", s.typography.families, compact),
    "### Type Scale",
    "",
    ...s.typography.scale.map((spec) => {
      const fields = (
        ["family", "size", "weight", "line_height", "letter_spacing"] as const
      ).flatMap((key) => {
        const t = spec[key];
        const label =
          { line_height: "line-height", letter_spacing: "tracking" }[
            key as string
          ] || key;
        return t
          ? [
              `${label}=${value(t.value)}${compact ? "" : ` [${t.status}; ${t.source.join(", ")}]`}`,
            ]
          : [];
      });
      return `- \`${spec.name}\`: ${fields.join(", ") || "no measurable values"} — ${spec.use}`;
    }),
    "",
    "### Principles",
    "",
    ...text(s.typography.principles),
    "",
    ...(compact
      ? []
      : [
          "### Open-source substitutes",
          "",
          ...text(s.typography.substitutes),
          "",
        ]),
  ];
}
function components(s: DesignSystem, compact = false): string[] {
  const lines = [compact ? "## Core Components" : "## Components", ""];
  for (const c of s.components) {
    lines.push(
      `### ${c.name}`,
      "",
      c.description,
      "",
      ...bullets(c.values, compact),
      ...(s.metadata.measurements_version === 1 && !c.values.length
        ? ['*Description only: no measurements linked to this model-assigned role. Use the separately identified measured samples.*'] : []),
      "",
    );
    if (s.metadata.measurements_version === 1 && !c.states.length)
      lines.push('*Hover, focus and expanded states were not verified.*', '');
    for (const state of c.states)
      lines.push(
        `- **State \`${state.name}\`** — ${state.observed ? "observed" : "not observed"}`,
        ...bullets(state.values, compact).map((x) => `  ${x.slice(2)}`),
      );
    lines.push("");
  }
  return lines;
}
export function renderDocuments(s: DesignSystem) {
  const scope = s.metadata.measurements_version === 1 ? [
    '> Scope: static element samples from the captured region. Names beginning with `measured-` identify exact source measurements, not global design rules. In a mix, these are unblended source references.',
    '',
  ] : [];
  const measurementEvidence = s.metadata.measurements_version === 1 ? [
    '', '### Measurement locators', '',
    ...Object.entries(s.metadata.measurement_locators as Record<string,{selector:string;source:string}> || {}).map(([name,record])=>
      `- \`${name}\` (${record.source}): \`${record.selector}\``),
  ] : [];
  const overview = [
    "## Overview",
    "",
    `**Identity:** ${s.overview.identity}`,
    `**Summary:** ${s.overview.summary}`,
    `**Density:** ${s.overview.density}`,
    `**Layout philosophy:** ${s.overview.layout_philosophy}`,
    "",
    "### Tone and personality",
    "",
    ...text([...s.overview.tone, ...s.overview.personality]),
    "",
  ];
  const gaps = [
    "## Known Gaps",
    "",
    ...(s.known_gaps.length
      ? s.known_gaps.map(
          (g) =>
            `- \`${g.code}\`: ${g.message} (source: ${g.source.join(", ")})`,
        )
      : ["- None recorded."]),
    "",
  ];
  const rules = [
    "### Do",
    "",
    ...text(s.guidelines.dos),
    "",
    "### Don't",
    "",
    ...text(s.guidelines.donts),
    "",
  ];
  const footer = "<!-- Generated from the normalized DesignSystem model. -->";
  const colorGroups: Array<[string, TokenValue[]]> = [
    ["Brand", s.colors.brand],
    ["Accent", s.colors.accent],
    ["Surfaces", s.colors.surfaces],
    ["Text", s.colors.text],
    ["Borders", s.colors.borders],
    ["Gradients", s.colors.gradients],
  ];
  const compact = [
    "# Design System — Compact",
    "",
    ...scope,
    ...overview,
    "## Quick Color Reference",
    "",
    ...bullets(
      colorGroups.flatMap((x) => x[1]),
      true,
    ),
    ...typography(s, true),
    ...components(s, true),
    "## Key Rules",
    "",
    ...rules,
    ...gaps,
    ...(s.metadata.measurements_version === 1 ? ['## Evidence', '', ...measurementEvidence] : []),
    footer,
  ]
    .join("\n")
    .trim();
  const extended = [
    "# Design System — Extended",
    "",
    ...scope,
    ...overview,
    "## Tokens — Colors",
    "",
    ...colorGroups.flatMap(([h, items]) => [
      `### ${h}`,
      "",
      ...table(items),
      "",
    ]),
    ...typography(s),
    "## Tokens — Spacing & Shapes",
    "",
    "### Spacing",
    "",
    `**Base unit:** ${s.spacing.base_unit ? value(s.spacing.base_unit.value) : "Not enough evidence"}`,
    "",
    ...bullets(s.spacing.tokens),
    "",
    "**Section padding**",
    "",
    ...bullets(s.spacing.section_padding),
    "",
    "**Card padding**",
    "",
    ...bullets(s.spacing.card_padding),
    "",
    "**Button padding**",
    "",
    ...bullets(s.spacing.button_padding),
    "",
    ...group("Border radius", s.shapes.radii),
    ...group("Photography geometry", s.shapes.image_geometry),
    ...group("Aspect ratios", s.shapes.aspect_ratios),
    `**Cropping:** ${s.shapes.cropping}`,
    "",
    ...components(s),
    "## Do's and Don'ts",
    "",
    ...rules,
    "## Surfaces",
    "",
    ...bullets(s.surfaces.levels),
    "",
    `**Philosophy:** ${s.surfaces.philosophy}`,
    "",
    "## Elevation",
    "",
    ...bullets(s.elevation.tokens),
    "",
    ...group("Borders", s.elevation.borders),
    `**Philosophy:** ${s.elevation.philosophy}`,
    "",
    "## Imagery",
    "",
    ...bullets(s.imagery.elements),
    "",
    `**Visual language:** ${s.imagery.visual_language}`,
    `**Photography:** ${s.imagery.photography}`,
    `**Iconography:** ${s.imagery.iconography}`,
    "",
    "## Layout",
    "",
    ...group("Layout values", s.layout.values),
    ...group("Container", s.layout.container),
    ...group("Grid and gutters", s.layout.grid),
    `**Whitespace philosophy:** ${s.layout.whitespace_philosophy}`,
    "",
    "## Responsive Behavior",
    "",
    ...group("Breakpoints", s.responsive.breakpoints),
    ...group("Touch targets", s.responsive.touch_targets),
    ...group("Layout changes", s.responsive.changes),
    "### Image behavior",
    "",
    ...text(s.responsive.image_behavior),
    "",
    "## Iteration Guide",
    "",
    ...text(s.iteration_guide),
    "",
    ...gaps,
    "## Agent Prompt Guide",
    "",
    ...text(s.agent_prompt_guide),
    "",
    "## Similar Brands",
    "",
    ...bullets(s.similar_brands),
    "",
    "## Quick Start",
    "",
    ...text(s.quick_start),
    "",
    "## Evidence",
    "",
    ...s.evidence.sources.map(
      (x) => `- \`${x.label}\` — ${x.status}, weight ${x.weight}: ${x.url}`,
    ),
    ...measurementEvidence,
    "",
    footer,
  ]
    .join("\n")
    .trim();
  return s.metadata.measurements_version === 1
    ? {compact: explainEmptySections(compact), extended: explainEmptySections(extended)}
    : { compact, extended };
}
interface ExportToken {
  category: string;
  name: string;
  value: string;
  role: string;
  source: string[];
  confidence: number;
  status: string;
}
const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(".", "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "token";
function unique(s: string, used: Set<string>) {
  const base = slug(s);
  let n = base,
    i = 2;
  while (used.has(n)) n = `${base}-${i++}`;
  used.add(n);
  return n;
}
export function collectTokens(s: DesignSystem): ExportToken[] {
  const tokens: ExportToken[] = [];
  const used: Record<string, Set<string>> = {};
  const add = (category: string, name: string, t: TokenValue | null) => {
    if (t)
      tokens.push({
        category,
        name: unique(name, (used[category] ||= new Set())),
        value:
          t.value && typeof t.value === "object" && !Array.isArray(t.value)
            ? Object.keys(t.value)
                .sort()
                .map(
                  (k) => `${k}: ${py((t.value as Record<string, unknown>)[k])}`,
                )
                .join(", ")
            : value(t.value),
        role: t.role,
        source: t.source,
        confidence: t.confidence,
        status: t.status,
      });
  };
  for (const [group, items] of Object.entries(s.colors))
    for (const t of items) {
      const g =
        (
          {
            surfaces: "surface",
            borders: "border",
            gradients: "gradient",
          } as Record<string, string>
        )[group] || group;
      add("color", t.name.startsWith(g + "-") ? t.name : `${g}-${t.name}`, t);
    }
  for (const t of s.typography.families) add("font-family", t.name, t);
  for (const t of s.typography.scale) {
    const name = slug(t.name);
    add("font-family", `${name}-family`, t.family);
    add("font-size", name, t.size);
    add("font-weight", name, t.weight);
    add("line-height", name, t.line_height);
    add("letter-spacing", name, t.letter_spacing);
  }
  add("spacing", "base-unit", s.spacing.base_unit);
  for (const [g, items] of [
    ["spacing", s.spacing.tokens],
    ["section-padding", s.spacing.section_padding],
    ["card-padding", s.spacing.card_padding],
    ["button-padding", s.spacing.button_padding],
  ] as Array<[string, TokenValue[]]>)
    for (const t of items) add("spacing", `${g}-${t.name}`, t);
  for (const [g, items] of [
    ["layout", s.layout.values],
    ["container", s.layout.container],
    ["grid", s.layout.grid],
  ] as Array<[string, TokenValue[]]>)
    for (const t of items) add("layout", `${g}-${t.name}`, t);
  for (const [g, items] of [
    ["shadow", s.elevation.tokens],
    ["border", s.elevation.borders],
    ["radius", s.shapes.radii],
  ] as Array<[string, TokenValue[]]>)
    for (const t of items) add(g, t.name, t);
  return tokens;
}
export function renderExports(s: DesignSystem) {
  const tokens = collectTokens(s);
  const primitives = new Map<string, string>();
  const counts: Record<string, number> = {};
  const key = (t: ExportToken) => JSON.stringify([t.category, t.value]);
  for (const t of tokens)
    if (!primitives.has(key(t)))
      primitives.set(
        key(t),
        `primitive-${(counts[t.category] = (counts[t.category] || 0) + 1)}`,
      );
  const comment = (t: ExportToken, literal = false) =>
    `role: ${t.role}; status: ${t.status}; confidence: ${pythonFixed(t.confidence, 2)}; source: ${t.source.join(", ")}${literal ? `; value: ${t.value}` : ""}`.replaceAll(
      "*/",
      "* /",
    );
  const variable = (c: string, n: string) => `--ds-${slug(c)}-${slug(n)}`;
  const css = [
    "/* Design Scraper export: CSS Variables */",
    "/* Primitive values are deduplicated from the normalized model. */",
    "/* Semantic variables preserve token roles and evidence metadata. */",
    ":root {",
  ];
  const emitted = new Set<string>();
  for (const t of tokens) {
    const name = variable(t.category, primitives.get(key(t))!);
    if (!emitted.has(name)) {
      emitted.add(name);
      css.push(`  ${name}: ${t.value}; /* ${comment(t, true)} */`);
    }
  }
  if (tokens.length) css.push("", "  /* Semantic roles */");
  for (const t of tokens)
    css.push(
      `  ${variable(t.category, t.name)}: var(${variable(t.category, primitives.get(key(t))!)}); /* ${comment(t)} */`,
    );
  css.push("}", "");
  const tailwind = [
    "/* Tailwind-compatible export generated from the normalized design system. */",
    "/* This does not imply that the analyzed site uses Tailwind CSS. */",
    "@theme {",
  ];
  const names = new Set<string>();
  const tw: Record<string, string> = {
    "font-family": "font",
    "font-size": "text",
    "line-height": "leading",
    "letter-spacing": "tracking",
    layout: "container",
  };
  for (const t of tokens) {
    const n =
      t.category === "font-family" ? t.name.replace(/-family$/, "") : t.name;
    tailwind.push(
      `  --${unique(`${tw[t.category] || t.category}-${n}`, names)}: ${t.value}; /* ${comment(t)} */`,
    );
  }
  tailwind.push("}", "");
  const dt: Record<string, string> = {
    color: "color",
    "font-family": "fontFamily",
    "font-size": "dimension",
    "font-weight": "fontWeight",
    "line-height": "dimension",
    "letter-spacing": "dimension",
    spacing: "dimension",
    radius: "dimension",
    shadow: "shadow",
    layout: "dimension",
    border: "border",
  };
  const entry = (t: ExportToken, primitive = false) => ({
    $type: dt[t.category],
    $value: t.value,
    $extensions: {
      "design-scraper": {
        role: primitive ? "primitive value from normalized token" : t.role,
        source: t.source,
        confidence: Number(pythonFixed(t.confidence, 4)),
        status: t.status,
      },
    },
  });
  const categories: Record<
    string,
    { primitive: Record<string, unknown>; semantic: Record<string, unknown> }
  > = {};
  for (const t of tokens) {
    const c = (categories[t.category] ||= { primitive: {}, semantic: {} });
    c.primitive[primitives.get(key(t))!] ||= entry(t, true);
    c.semantic[t.name] = entry(t);
  }
  // The output contract writes integer-valued float confidences as 1.0 / 0.0.
  const json =
    JSON.stringify(
      {
        $schema: "https://design-tokens.github.io/community-group/format/",
        name: "Design Scraper tokens",
        metadata: {
          format: "DTCG-compatible",
          convention: "category.primitive|semantic.token-name",
          sources: s.evidence.sources.map((x) => x.label),
        },
        tokens: categories,
      },
      null,
      2,
    ).replace(/("confidence": )([01])([,\n])/g, "$1$2.0$3") + "\n";
  return {
    css_variables: css.join("\n"),
    tailwind: tailwind.join("\n"),
    design_tokens: json,
  };
}
