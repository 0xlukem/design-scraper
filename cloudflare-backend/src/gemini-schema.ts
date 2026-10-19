import schema from "./domain/schema.json";
/** Bounded generation envelope; the full server-side DesignSystem schema is authoritative. */
export const designKeys = [
  "metadata",
  "overview",
  "colors",
  "typography",
  "spacing",
  "layout",
  "elevation",
  "shapes",
  "components",
];
export const guidanceKeys = Object.keys(schema.properties).filter(
  (k) => !designKeys.includes(k),
);
// Gemini rejects the expanded domain schema as too complex. Constrain the
// section envelope here; the prompt carries the full schema and normalize()
// still validates every nested token, value and provenance before publication.
function envelope(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.$ref === "string")
    return envelope((schema.$defs as Record<string, Record<string, unknown>>)[value.$ref.split("/").at(-1)!]);
  if (value.type === "object") return { type: "object", additionalProperties: true };
  if (value.type === "array") return { type: "array", items: envelope(value.items as Record<string, unknown>) };
  return { type: value.type, ...(value.enum ? { enum: value.enum } : {}) };
}
const section = (keys: string[]) => ({
  type: "object",
  properties: Object.fromEntries(keys.map(k => [k, envelope((schema.properties as Record<string, Record<string, unknown>>)[k])])),
  required: keys,
  additionalProperties: false,
});
export const geminiSchema = {
  type: "object",
  properties: { design: section(designKeys), guidance: section(guidanceKeys) },
  required: ["design", "guidance"],
  additionalProperties: false,
};
export function unpackGemini(raw: string): string {
  const p = JSON.parse(raw);
  const result: Record<string, unknown> = {};
  for (const [group, keys] of [
    ["design", designKeys],
    ["guidance", guidanceKeys],
  ] as const) {
    const values = p[group];
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).some((k) => !keys.includes(k))
    )
      throw new Error("Invalid Gemini response envelope");
    for (const key of keys) if (key in values) result[key] = values[key];
  }
  return JSON.stringify(result);
}
