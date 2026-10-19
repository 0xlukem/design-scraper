// Copies existing project credentials directly to Cloudflare; never prints secret values.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
function parse(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((s) => /^[A-Z_]+=/.test(s))
      .map((s) => {
        const i = s.indexOf("=");
        return [
          s.slice(0, i),
          s
            .slice(i + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}
let saved = {};
try {
  saved = parse(await readFile(".dev.vars", "utf8"));
} catch {}
const key = saved.GEMINI_API_KEY;
if (!key || key.startsWith("replace-"))
  throw new Error("Set GEMINI_API_KEY in this backend's .dev.vars before provisioning.");
const secrets = {
  GEMINI_API_KEY: key,
  IP_HASH_SECRET: saved.IP_HASH_SECRET || randomBytes(32).toString("hex"),
  PHASE8_AUTH_TOKEN: saved.PHASE8_AUTH_TOKEN || randomBytes(32).toString("hex"),
};
await writeFile(
  ".dev.vars",
  Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
const child = spawn(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk"],
  { stdio: ["pipe", "pipe", "pipe"] },
);
child.stdin.end(JSON.stringify(secrets));
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
const code = await new Promise((resolve) => child.on("close", resolve));
if (code !== 0) {
  console.error(
    "Cloudflare secret provisioning failed. No secret values were printed.",
  );
  process.exit(1);
}
console.log(
  "Gemini, IP hashing and administrative authentication secrets configured.",
);
