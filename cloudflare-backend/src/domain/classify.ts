const dimension = /^-?\d*\.?\d+(px|em|rem)$/;
const weight =
  /^(100|200|300|400|500|600|700|800|900|normal|bold|lighter|bolder)$/;
const colors = new Set(
  "transparent currentColor black white red green blue yellow orange purple pink brown cyan magenta gray grey slate cream ivory navy teal olive maroon aqua lime silver gold tan beige coral salmon khaki plum orchid indigo violet crimson azure cornflowerblue lightgray darkgray lightblue darkblue".split(
    " ",
  ),
);
const color = (s: string) =>
  /^#[0-9a-f]{3,8}$/i.test(s) ||
  /^(rgba?|hsla?|oklab|oklch|lch|lab|hwb|color-mix|color)\(/i.test(s) ||
  colors.has(s.toLowerCase());
const isDimension = (s: string) => s === "0" || dimension.test(s);
function shadow(s: string) {
  s = s.toLowerCase();
  if (!s || s === "none") return false;
  if (/^(inset\s|0\s+0|0px\s+0px|--)/.test(s)) return true;
  const t = s.replaceAll(",", " ").split(/\s+/);
  return t.length >= 3 && t.filter(isDimension).length >= 2;
}
const hints: Array<[string, string[]]> = [
  [
    "colors",
    [
      "color",
      "bg",
      "background",
      "surface",
      "border-color",
      "link",
      "accent",
      "primary",
      "secondary",
      "tertiary",
      "neutral",
      "error",
      "on-",
    ],
  ],
  [
    "spacing",
    ["space", "gap", "margin", "padding", "gutter", "inset", "offset"],
  ],
  ["rounded", ["radius", "rounded", "corner"]],
  [
    "typography",
    [
      "font-family",
      "fontfamily",
      "font-name",
      "typeface",
      "family",
      "font-size",
      "fontsize",
      "text-size",
      "line-height",
      "lineheight",
      "leading",
      "letter-spacing",
      "letterspacing",
      "tracking",
    ],
  ],
  ["shadows", ["shadow", "elevation", "depth"]],
  ["weights", ["weight"]],
];
export function classifyVariables(raw: Record<string, string | null | undefined>) {
  const result: Record<string, Record<string, string>> = {
    colors: {},
    spacing: {},
    rounded: {},
    typography: {},
    shadows: {},
    weights: {},
    other: {},
  };
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    const v = String(value).trim();
    if (!v) continue;
    const name = key.trim().replace(/^-+/, ""),
      n = name.toLowerCase();
    let group: string | undefined;
    for (const [g, hs] of hints) {
      if (!hs.some((h) => n.includes(h))) continue;
      if (
        g === "typography" ||
        (g === "colors" && color(v)) ||
        (["spacing", "rounded"].includes(g) && isDimension(v)) ||
        (g === "weights" && weight.test(v)) ||
        (g === "shadows" && (shadow(v) || n.includes("shadow")))
      ) {
        group = g;
        break;
      }
    }
    group ||= color(v)
      ? "colors"
      : shadow(v)
        ? "shadows"
        : isDimension(v)
          ? "spacing"
          : weight.test(v)
            ? "weights"
            : "other";
    result[group][name] = v;
  }
  return result;
}
