import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Playwright normally skips user interception on redirected requests. This
// application requires every hop to pass URL/DNS validation and public fetch.
// Keep the pinned runtime and local Chromium driver behavior identical. Fail
// installation on dependency drift instead of silently losing this boundary.
const targets = [
  ["@cloudflare/playwright", "1.3.6", "lib/playwright-core/src/server/chromium/crNetworkManager.js"],
  ["playwright-core", "1.63.0", "lib/coreBundle.js"],
];
const original = "if (redirectedFrom || !this._userRequestInterceptionEnabled && this._protocolRequestInterceptionEnabled) {";
const patched = "if (/* design-scraper: intercept every redirect */ !this._userRequestInterceptionEnabled && this._protocolRequestInterceptionEnabled) {";
for (const [name, version, relative] of targets) {
  const root = new URL(`../node_modules/${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  if (pkg.version !== version) throw new Error(`Review redirect interception before upgrading ${name}.`);
  const path = fileURLToPath(new URL(relative, root));
  const source = await readFile(path, "utf8");
  if (source.split(patched).length === 2 && !source.includes(original)) continue;
  if (source.split(original).length !== 2 || source.includes(patched))
    throw new Error(`Unexpected redirect interception code in ${name}.`);
  await writeFile(path, source.replace(original, patched));
}
console.log("Pinned Playwright drivers intercept every redirect hop.");
