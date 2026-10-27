// Serve the actual Pages build and run Chromium with intercepted API responses.
// No Cloudflare account, provider credentials, Python or containers are needed.
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const root = resolve("../frontend/dist");
await access(resolve(root, "index.html"));
// Match this build's path rules; deployment-host rules are checked with Pages.
const headerRules = [];
for (const line of (await readFile(resolve(root, "_headers"), "utf8")).split("\n")) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) headerRules.push({ path: line.trim(), headers: {} });
  else {
    const i = line.indexOf(":");
    headerRules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
const headersFor = path => Object.assign({}, ...headerRules.filter(rule =>
  rule.path.endsWith("*") ? path.startsWith(rule.path.slice(0, -1)) : path === rule.path,
).map(rule => rule.headers));
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".xml": "application/xml" };
const serve = async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const path = resolve(root, "." + pathname);
    if (path !== root && !path.startsWith(root + "/")) { res.writeHead(404).end(); return; }
    let data, type, status = 200;
    try { data = await readFile(path); type = mime[extname(path)] || "application/octet-stream"; }
    catch {
      try { data = await readFile(resolve(path, "index.html")); type = "text/html"; }
      catch { data = await readFile(resolve(root, "404.html")); type = "text/html"; status = 404; }
    }
    res.writeHead(status, { ...headersFor(pathname), "content-type": type }); res.end(data);
  } catch { res.writeHead(500).end(); }
};
const server = createServer(serve);
const certDir = await mkdtemp(resolve(tmpdir(), "design-scraper-ui-tls-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", resolve(certDir, "key.pem"), "-out", resolve(certDir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const secureServer = createHttpsServer({ key: await readFile(resolve(certDir, "key.pem")), cert: await readFile(resolve(certDir, "cert.pem")) }, serve);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await new Promise(resolve => secureServer.listen(0, "127.0.0.1", resolve));
try {
  const http = `http://127.0.0.1:${server.address().port}`;
  const https = `https://127.0.0.1:${secureServer.address().port}`;
  for (const [script, url] of [["verify-landing.mjs", http], ["verify-home-flow.mjs", http], ["verify-pages.mjs", `${http}/app/`], ["verify-byok.mjs", `${https}/app/`], ["verify-front-features.mjs", `${http}/app/`], ["verify-telemetry.mjs", `${https}/app/`], ["verify-motion.mjs", `${http}/app/`]]) {
    const child = spawn(process.execPath, ["scripts/" + script], { stdio: "inherit", env: { ...process.env, PAGES_URL: url, LOCAL_UI_HTTPS: "true" } });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
    });
    if (process.exitCode) break;
  }
} finally {
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => secureServer.close(resolve))]);
  await rm(certDir, { recursive: true, force: true });
}
