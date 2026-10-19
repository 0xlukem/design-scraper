import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? undefined : process.argv[i + 1];
};
const endpoint =
  arg("--endpoint") ||
  "https://design-scraper-phase8.lucas-malizia27.workers.dev";
const target = arg("--target") || "https://example.com/";
const second = arg("--second");
const captureOnly = process.argv.includes("--capture-only");
const bias = Number(arg("--bias") || 0);
const local = captureOnly ? await readFile(".dev.vars", "utf8") : "";
const token = local
  .split(/\r?\n/)
  .find((s) => s.startsWith("PHASE8_AUTH_TOKEN="))
  ?.split("=")
  .slice(1)
  .join("=")
  .trim();
if (captureOnly && !token) throw new Error("Administrative access is unavailable. Capture diagnostics also require private mode.");
const events = [];
let buffer = "";
let connected = false;
let tailExit = null;
let tailStderr = "";
const tail = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "tail",
    "design-scraper-phase8",
    "--format",
    "json",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
// Tail payloads may contain request headers: parse in memory and persist ONLY allowlisted telemetry.
function receive(chunk) {
  buffer += chunk;
  while (true) {
    const start = buffer.indexOf("{");
    if (start < 0) {
      if (buffer.includes("Connected")) connected = true;
      if (buffer.length > 10000) buffer = "";
      return;
    }
    let depth = 0,
      quoted = false,
      escape = false,
      end = -1;
    for (let i = start; i < buffer.length; i++) {
      const ch = buffer[i];
      if (quoted) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) return;
    let e;
    try {
      e = JSON.parse(buffer.slice(start, end));
    } catch {}
    buffer = buffer.slice(end);
    if (!e) continue;
    connected = true;
    const logs = [];
    for (const l of e.logs || []) {
      for (const message of l.message || []) {
        try {
          const p = typeof message === "string" ? JSON.parse(message) : message;
          if (
            [
              "analysis_complete",
              "analysis_failed",
              "capture_stage",
              "capture_complete",
            ].includes(p?.event)
          )
            logs.push(p);
        } catch {}
      }
    }
    events.push({
      outcome: e.outcome,
      cpu_ms: e.cpuTime ?? null,
      wall_ms: e.wallTime ?? null,
      event_type: e.event?.rpcMethod || e.event?.request?.method || null,
      logs,
    });
  }
}
tail.stdout.on("data", (d) => receive(String(d)));
tail.stderr.on("data", (d) => {
  tailStderr += String(d);
  if (String(d).includes("Connected")) connected = true;
});
tail.on("exit", (code) => {
  tailExit = code;
});
await new Promise((r) => setTimeout(r, 8000));
const started = Date.now();
let response, body, responseFinished;
try {
  response = await fetch(
    new URL(
      captureOnly
        ? second
          ? "/api/diagnostics/capture-mix"
          : "/api/diagnostics/capture"
        : second
          ? "/api/mix"
          : "/api/analyze",
      endpoint,
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(captureOnly ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(
        second ? { url_1: target, url_2: second, bias } : { url: target },
      ),
      signal: AbortSignal.timeout(195000),
    },
  );
  body = await response.json();
  responseFinished = Date.now();
  await new Promise((r) => setTimeout(r, 12000));
} finally {
  tail.kill("SIGTERM");
}
const result = {
  recorded_at: new Date().toISOString(),
  target_origin: new URL(target).origin,
  status: response.status,
  analysis_id: response.headers.get("x-analysis-id"),
  client_wall_ms: responseFinished - started,
  browser_wall_ms: body.browser_wall_ms ?? null,
  error_code: body.detail?.code || null,
  error_message: body.detail?.message || null,
  usage: body.metadata?.usage || null,
  kind: body.kind || (captureOnly ? "capture-check" : "analysis"),
  capture_metrics: body.metrics || null,
  counted_subrequests: body.counted_subrequests ?? null,
  formats: body.exports ? Object.keys(body.exports) : [],
  format_sha256: body.exports
    ? Object.fromEntries(
        Object.entries(body.exports).map(([k, v]) => [
          k,
          createHash("sha256").update(v).digest("hex"),
        ]),
      )
    : {},
  tail_connected: connected,
  tail_exit_code: tailExit,
  tail_error_code:
    tailStderr.match(/(?:code:|error code:)\s*(\d+)/i)?.[1] || null,
  tail_error_kind: /maximum.*tail|too many.*tail/i.test(tailStderr)
    ? "tail-session-limit"
    : /Authentication|authenticate/i.test(tailStderr)
      ? "authentication"
      : tailStderr.includes("ERROR")
        ? "cli-error"
        : null,
  events,
  free_gate: "needs-authoritative-measurements",
};
if (
  body.success &&
  !captureOnly &&
  (body.design_md !== body.documents?.extended ||
    Object.values(body.exports).some((x) => typeof x !== "string" || !x.length))
)
  throw new Error("The remote output contract failed.");
await mkdir("reports", { recursive: true });
const stamp = Date.now();
await writeFile(
  `reports/smoke-${stamp}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
if (body.success)
  await writeFile(
    `reports/result-${stamp}.json`,
    JSON.stringify(body, null, 2) + "\n",
  );
console.log(JSON.stringify(result, null, 2));
process.exitCode = response.ok ? 0 : 1;
