// Local-only entrypoint. Never included in the public Worker bundle.
import { DurableObject } from "cloudflare:workers";
import { ResourceRelay } from "../src/resource-relay";
import { RelayBudget, RelayResources } from "../src/relay-resources";
import { ApiError } from "../src/errors";
import { analyze } from "../src/providers";
import { config } from "../src/config";
import fixtures from "./fixtures/contracts.json";
export { ResourceRelay };
interface TestEnv {
  RESOURCE_RELAY: DurableObjectNamespace<ResourceRelay>;
  COORDINATOR: DurableObjectNamespace<RelayCoordinator>;
}
export class RelayCoordinator extends DurableObject<TestEnv> {
  async fetch(request: Request): Promise<Response> {
    const scenario = new URL(request.url).pathname.slice(1);
    if (scenario.startsWith("provider-")) {
      const gemini = scenario.includes("gemini");
      const settings = { AI_PROVIDER: gemini ? "gemini" : "openai", GEMINI_API_KEY: "fixture-only",
        OPENAI_API_KEY: "fixture-only", GEMINI_MODEL: "fixture-gemini", OPENAI_MODEL: "fixture-openai",
        AI_FUNDING: "byok" };
      try {
        const result = await analyze(fixtures[0].sources.map(source => ({ ...source,
          label: source.label === "web_1" ? "web_1" : "web_2", screenshot: "YWJj" })),
          settings, { ...config({}), attempts: 1 }, AbortSignal.timeout(5000));
        return Response.json({ success: true, tokens: result.usage.total_tokens });
      } catch (error) {
        return Response.json({ success: false, code: error instanceof ApiError ? error.code : "UNKNOWN" });
      }
    }
    const budget = new RelayBudget();
    const output: unknown[] = [];
    for (let source = 0; source < (["mix", "heavy-mix"].includes(scenario) ? 2 : 1); source++) {
      const controller = new AbortController();
      const client = new RelayResources(
        () => this.env.RESOURCE_RELAY.get(this.env.RESOURCE_RELAY.newUniqueId()),
        controller.signal, Date.now() + (scenario === "deadline" ? 50 : 20000), budget,
        scenario === "aggregate" ? 6_000_000 : undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let error: string | undefined;
      let completed = 0;
      try {
        if (scenario === "cancel") timer = setTimeout(() => controller.abort(), 150);
        const count = scenario === "heavy-mix" ? 4 : ["cancel", "deadline", "aggregate", "oversize"].includes(scenario) ? 4 : 152;
        const results = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
          const path = scenario === "cancel" || scenario === "deadline" ? "slow"
            : scenario === "aggregate" ? "large" : scenario === "oversize" ? "oversize" : scenario === "heavy-mix" ? "heavy" : `asset-${index}`;
          try {
            const result = await client.load({ url: `https://source-${source}.example/${path}`,
              method: "GET", headers: {}, body: null });
            if (!result.body.byteLength) throw new Error("Empty binary body");
            completed++;
          } catch (e) {
            if (e instanceof ApiError) error ||= e.code;
            client.cancel();
            throw e;
          }
        }));
        if (results.some(result => result.status === "rejected")) error ||= "CANCELLED";
      } finally {
        clearTimeout(timer);
        await client.close();
      }
      output.push({ completed, error, metrics: client.metrics, transport: client.transport });
      if (error) break;
    }
    return Response.json({ scenario, sources: output, parent_internal_calls: budget.calls });
  }
}
export default {
  async fetch(request: Request, env: TestEnv) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/job/")) {
      const [, , id, operation] = path.split("/");
      const stub = env.RESOURCE_RELAY.getByName(id);
      return stub.fetch(new Request(`https://resource-relay/${operation}`, request));
    }
    return env.COORDINATOR.get(env.COORDINATOR.newUniqueId()).fetch(request);
  },
};
