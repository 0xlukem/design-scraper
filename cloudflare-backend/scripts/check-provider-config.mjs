import { build } from "esbuild";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "design-scraper-provider-"));
try {
  await build({
    entryPoints: ["src/providers.ts"],
    outfile: join(dir, "providers.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const { providerRequest } = await import(
    pathToFileURL(join(dir, "providers.mjs"))
  );
  const key = (await readFile(".dev.vars", "utf8"))
    .split(/\r?\n/)
    .find((x) => x.startsWith("GEMINI_API_KEY="))
    ?.slice("GEMINI_API_KEY=".length);
  if (!key) throw new Error("Project Gemini credential unavailable");
  const model = process.argv[2] || "gemini-3.6-flash";
  const req = providerRequest(
    "gemini",
    key,
    model,
    "Return a minimal JSON object.",
    [],
    { outputTokens: 1 },
  );
  if (process.argv.includes("--simple"))
    req.body.generationConfig.responseJsonSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };
  if (process.argv.includes("--expanded")) {
    const root = req.body.generationConfig.responseJsonSchema;
    const clean = (x) => {
      if (Array.isArray(x)) return x.map(clean);
      if (!x || typeof x !== "object") return x;
      if (x.$ref) return clean(root.$defs[x.$ref.split("/").at(-1)]);
      return Object.fromEntries(
        Object.entries(x)
          .filter(
            ([k]) => !["$defs", "title", "default", "pattern"].includes(k),
          )
          .map(([k, v]) => (k === "const" ? ["enum", [v]] : [k, clean(v)])),
      );
    };
    req.body.generationConfig.responseJsonSchema = clean(root);
  }
  const sectionsArg = process.argv.find((x) => x.startsWith("--sections="));
  if (sectionsArg) {
    const names = sectionsArg.slice("--sections=".length).split(",");
    const sch = req.body.generationConfig.responseJsonSchema;
    sch.properties = Object.fromEntries(
      Object.entries(sch.properties).filter(([k]) => names.includes(k)),
    );
    sch.required = sch.required.filter((k) => names.includes(k));
  }
  if (process.argv.includes("--plain"))
    delete req.body.generationConfig.responseJsonSchema;
  req.body.generationConfig.maxOutputTokens = 64;
  await writeFile(join(dir, "body.json"), JSON.stringify(req.body));
  const child = spawnSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "40",
      "--config",
      "-",
      "--data-binary",
      "@" + join(dir, "body.json"),
      req.url,
    ],
    {
      encoding: "utf8",
      input:
        "header = " +
        JSON.stringify("x-goog-api-key: " + key) +
        '\nheader = "Content-Type: application/json"\n',
      maxBuffer: 1000000,
    },
  );
  if (child.status !== 0)
    console.log(
      JSON.stringify({ diagnostic: "transport-failed", exit: child.status }),
    );
  else {
    const body = JSON.parse(child.stdout);
    console.log(
      JSON.stringify({
        status: body.error?.code || 200,
        error: body.error
          ? String(body.error.message || "")
              .split(key)
              .join("[REDACTED]")
              .slice(0, 1200)
          : null,
        details: body.error?.details
          ? JSON.stringify(body.error.details)
              .split(key)
              .join("[REDACTED]")
              .slice(0, 1200)
          : null,
        finish: body.candidates?.[0]?.finishReason || null,
      }),
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
