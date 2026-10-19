import ts from "typescript";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "design-scraper-runtime-"));
await build({
  entryPoints: ["tests/runtime-entry.ts"],
  outfile: join(dir, "test.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["cloudflare:workers", "node:*"],
  logLevel: "silent",
});
const parsedConfig = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8"));
if (parsedConfig.error) throw new Error("Invalid Wrangler JSONC configuration");
const vars = parsedConfig.config.vars;
const options = {
  script: await readFile(join(dir, "test.mjs"), "utf8"),
  modules: true,
  compatibilityDate: "2026-09-09",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ...vars,
    GEMINI_API_KEY: "test-only",
    IP_HASH_SECRET: "test-only",
  },
  durableObjects: { QUOTA: { className: "QuotaCoordinator", useSQLite: true } },
  durableObjectsPersist: join(dir, "state"),
};
let mf = new Miniflare({
  ...convertV4MiniflareOptions(options),
  resourcePersistencePath: join(dir, "state"),
});
async function rpc(method, args, name = "budget") {
  const r = await mf.dispatchFetch("http://test/test/rpc", {
    method: "POST",
    body: JSON.stringify({ method, args, name }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
const base = {
  id: "one",
  ip: "hash",
  sources: 1,
  provider: "gemini",
  version: "1",
};
try {
  const stream = await mf.dispatchFetch('http://test/test/stream');
  assert.equal(stream.headers.get('content-type'), 'application/x-ndjson');
  const reader = stream.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(JSON.parse(first.trim()).progress.percent, 25);
  let rest = '';
  while (true) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
  assert.equal(JSON.parse(rest.trim()).type, 'result');
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      rpc("admit", [{ ...base, id: String(i) }]),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  const winner = String(results.findIndex((r) => r.ok));
  // Persist provider dispatch counters on the same live lease before restart.
  if ((await rpc('status', [])).demoCalls.total.generation === 0) {
    await rpc('providerCall', [winner, 1, 'auxiliary']);
    await rpc('providerCall', [winner, 1, 'auxiliary']);
    await rpc('providerCall', [winner, 2, 'generation']);
  }
  await mf.dispose();
  mf = new Miniflare({
    ...convertV4MiniflareOptions(options),
    resourcePersistencePath: join(dir, "state"),
  });
  assert.equal(
    (await rpc("admit", [{ ...base, id: "after-restart" }])).code,
    "CAPACITY_REACHED",
  );
  assert.deepEqual((await rpc('status', [])).demoCalls.total, { generation: 1, auxiliary: 1 });
  const publicQuota = await rpc('publicStatus', []);
  assert.equal(publicQuota.analyses.used, 1);
  assert.equal(publicQuota.concurrency.active, 1);
  assert.equal('totalMicroUsdUsedOrReserved' in publicQuota, false);
  assert.equal('demoCalls' in publicQuota, false);
  assert.equal('ips' in publicQuota, false);
  const delay = await rpc("browserStart", [winner]);
  assert.equal(delay, 0);
  assert.ok((await rpc("browserStart", [winner])) > 19000);
  await rpc("finish", [
    winner,
    { browserMs: 1200, tokens: 5000, provider: "gemini", version: "1" },
  ]);
  assert.equal((await rpc("admit", [base])).ok, true);
  await rpc("finish", [
    "one",
    {
      browserMs: 0,
      tokens: 0,
      provider: "gemini",
      version: "1",
      failure: "configuration",
    },
  ]);
  assert.equal(
    (await rpc("admit", [{ ...base, id: "blocked" }])).code,
    "PROVIDER_UNAVAILABLE",
  );
  assert.equal(
    (await rpc("admit", [{ ...base, id: "rotated", version: "2" }])).ok,
    true,
  );
  const reserved = await rpc("status", []);
  assert.ok(reserved.totalMicroUsdUsedOrReserved > 0);
  for (let i = 0; i < 5; i++) {
    const id = `daily-${i}`;
    // A separate IP per admission tests the shared monetary ledger in SQLite.
    assert.equal((await rpc("admit", [{ ...base, id, ip: id }], "money")).ok, true);
    await rpc("finish", [id, { browserMs: 1000, tokens: 5000, microUsd: 100000, provider: "gemini", version: "1" }], "money");
  }
  assert.equal((await rpc("status", [], "money")).totalMicroUsdUsedOrReserved, 500000);
  await mf.dispose();
  mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(dir, "state") });
  assert.equal((await rpc("status", [], "money")).totalMicroUsdUsedOrReserved, 500000);
  assert.equal((await rpc("status", [])).totalMicroUsdUsedOrReserved, reserved.totalMicroUsdUsedOrReserved);
  assert.equal((await rpc("admit", [{ ...base, id: "total" }], "lifetime")).ok, true);
  await rpc("finish", ["total", { browserMs: 0, tokens: 0, microUsd: 30000000, provider: "gemini", version: "1" }], "lifetime");
  assert.equal((await rpc("admit", [{ ...base, id: "exhausted" }], "lifetime")).code, "PROJECT_BUDGET_EXHAUSTED");
  // Upgrade existing SQLite state: BYOK shares capture/admission, never demo
  // money/tokens/circuits. Persist a live lease across an actual workerd restart.
  assert.equal((await rpc("admit", [{ ...base, id: "own", funding: "byok", sources: 2 }], "lifetime")).ok, true);
  await rpc('providerCall', ['own', 1, 'generation'], 'lifetime');
  const ownReserved = await rpc("status", [], "lifetime");
  assert.deepEqual(ownReserved.demoCalls.total, { generation: 0, auxiliary: 0 });
  assert.equal(ownReserved.totalMicroUsdUsedOrReserved, 30000000);
  assert.equal(ownReserved.tokensUsedOrReserved, 0);
  // Both active sources reserve their configured deadline plus launch/cleanup
  // allowance; this assertion follows the deployment profile used by workerd.
  assert.equal(ownReserved.browserMsUsedOrReserved, 2 * (Number(vars.SCRAPE_TIMEOUT_MS) + 15000));
  await mf.dispose();
  mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(dir, "state") });
  assert.equal((await rpc("status", [], "lifetime")).active, 1);
  await rpc("finish", ["own", { browserMs: 1200, tokens: 40000, microUsd: 100000, provider: "gemini", version: "1", failure: "configuration" }], "lifetime");
  const ownSettled = await rpc("status", [], "lifetime");
  assert.equal(ownSettled.totalMicroUsdUsedOrReserved, 30000000);
  assert.equal(ownSettled.tokensUsedOrReserved, 0);
  assert.equal(ownSettled.browserMsUsedOrReserved, 1200);
  assert.equal((await rpc("admit", [{ ...base, id: "demo-again" }], "lifetime")).code, "PROJECT_BUDGET_EXHAUSTED");
  assert.equal((await rpc("admit", [{ ...base, id: "own-again", funding: "byok" }], "lifetime")).ok, true);
  console.log(
    "workerd + SQLite: concurrency, persistence/restart, launch interval, monetary settlement, lifetime cap, circuit recovery and BYOK isolation across restart passed.",
  );
} finally {
  await mf.dispose();
  await rm(dir, { recursive: true, force: true });
}
