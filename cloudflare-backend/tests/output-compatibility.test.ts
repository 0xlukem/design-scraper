import { expect, it } from "vitest";
import outputs from "./fixtures/output-compatibility.json";
import classifications from "./fixtures/classification-cases.json";
import { normalize, type Source } from "../src/domain/normalize";
import { renderDocuments, renderExports } from "../src/domain/renderers";
import { classifyVariables } from "../src/domain/classify";

// Fixed, independently established outputs. Do not regenerate expectations from
// the implementation under test when changing normalization or formatting.
it.each(outputs)("preserves all five formats: $name", f => {
  const system = normalize(JSON.stringify(f.raw), f.sources as Source[]);
  expect(system).toEqual(f.normalized);
  expect(renderDocuments(system)).toEqual(f.documents);
  expect(renderExports(system)).toEqual(f.exports);
});
it.each(classifications.map((f, index) => ({ ...f, index })))("preserves classification case $index", f => {
  expect(classifyVariables(f.raw)).toEqual(f.expected);
});
