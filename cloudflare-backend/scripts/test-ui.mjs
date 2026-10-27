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
const headers = Object.fromEntries((await readFile(resolve(root, "_headers"), "utf8"))
  .split("\n").filter(s => s.trim() && s.trim() !== "/*")
  .map(s => { const i = s.indexOf(":"); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const serve = async (req, res) => {
  try {
    const path = resolve(root, "." + decodeURIComponent(new URL(req.url, "http://local").pathname));
    if (path !== root && !path.startsWith(root + "/")) { res.writeHead(404).end(); return; }
    let data, type;
    try { data = await readFile(path); type = mime[extname(path)] || "application/octet-stream"; }
    catch {
      if (extname(path)) { res.writeHead(404).end(); return; }
      data = await readFile(resolve(root, "index.html")); type = "text/html";
    }
    res.writeHead(200, { ...headers, "content-type": type }); res.end(data);
  } catch { res.writeHead(500).end(); }
};
const server = createServer(serve);
const certDir = await mkdtemp(resolve(tmpdir(), "design-scraper-ui-tls-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", resolve(certDir, "key.pem"), "-out", resolve(certDir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const secureServer = createHttpsServer({ key: await readFile(resolve(certDir, "key.pem")), cert: await readFile(resolve(certDir, "cert.pem")) }, serve);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
await new Promise(resolve => secureServer.listen(0, "127.0.0.1", resolve));
try {
  for (const [script, url] of [["verify-pages.mjs", `http://127.0.0.1:${server.address().port}`], ["verify-byok.mjs", `https://127.0.0.1:${secureServer.address().port}`], ["verify-front-features.mjs", `http://127.0.0.1:${server.address().port}`], ["verify-telemetry.mjs", `https://127.0.0.1:${secureServer.address().port}`], ["verify-mix-flow.mjs", `http://127.0.0.1:${server.address().port}`], ["verify-motion.mjs", `http://127.0.0.1:${server.address().port}`]]) {
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
