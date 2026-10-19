import { readFile } from "node:fs/promises";
const vars = await readFile(".dev.vars", "utf8");
const token = vars.split(/\r?\n/).find(s => s.startsWith("PHASE8_AUTH_TOKEN="))?.slice(18).trim();
if (!token) throw new Error("Administrative access is not configured locally.");
const response = await fetch("https://design-scraper-phase8.lucas-malizia27.workers.dev/api/diagnostics/budget", {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Budget query failed: HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
