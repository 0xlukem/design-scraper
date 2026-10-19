// Re-render saved API results locally. Fixed expected-output coverage lives in
// tests/fixtures; this command checks actual saved response consistency, not AI.
import { build } from "esbuild";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "design-scraper-results-"));
try {
  await build({ stdin: { contents: "export {default as validate} from './src/domain/validate.js'; export {renderDocuments,renderExports} from './src/domain/renderers';", resolveDir: process.cwd() }, outfile: join(dir, "domain.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { validate, renderDocuments, renderExports } = await import(pathToFileURL(join(dir, "domain.mjs")));
  const files = process.argv.slice(2);
  if (!files.length) files.push(...(await readdir("reports")).filter(f => /^result-.*\.json$/.test(f)).map(f => join("reports", f)));
  let checked = 0;
  for (const file of files) {
    const result = JSON.parse(await readFile(file, "utf8"));
    if (result.kind === "capture-check") continue;
    assert.equal(result.success, true, file);
    // Captured CSS is not part of the API response. Re-normalizing with empty
    // evidence would invent missing-evidence gaps in an already normalized model.
    const system = structuredClone(result.design_system);
    assert.ok(validate(system), `Invalid saved DesignSystem: ${file}`);
    assert.deepEqual(renderDocuments(system), result.documents, `Markdown differs: ${file}`);
    assert.deepEqual(renderExports(system), result.exports, `Exports differ: ${file}`);
    assert.equal(result.design_md, result.documents.extended, file);
    checked++;
  }
  assert.ok(checked, "No saved successful result is available. Use npm test for fixed contract fixtures.");
  console.log(`${checked} saved analyses: all five formats are consistent.`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { await rm(dir, { recursive: true, force: true }); }
