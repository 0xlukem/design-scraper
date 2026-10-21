import { streamAnalysis, type AnalysisProgress, type AnalysisTelemetry } from './telemetry';
import { maximumMicroUsd } from './cost';
import { timingSafeEqual } from "node:crypto";
import { DurableObject } from "cloudflare:workers";
import { config, type Settings } from "./config";
import { ApiError, boundedText, errorResponse, sleep } from "./errors";
import { PublicNetwork } from "./url-safety";
import { targetUrl } from "./url-safety";
import { providerConfig, analyze } from "./providers";
import { normalize, type Source } from "./domain/normalize";
import { renderDocuments, renderExports } from "./domain/renderers";
import { capture } from "./capture";
import { RelayBudget, RelayResources } from "./relay-resources";
import { withBrowser } from "./browser-session";
import { requestCredentials, providerSettings, providerCatalog, type ByokCredentials } from "./byok";
export { QuotaCoordinator } from "./quota";
export { ResourceRelay } from "./resource-relay";
export interface Secrets {
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  IP_HASH_SECRET?: string;
  PHASE8_AUTH_TOKEN?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_MODEL?: string;
  XAI_MODEL?: string;
  AI_INPUT_PRICE_USD_PER_MILLION?: string;
  AI_OUTPUT_PRICE_USD_PER_MILLION?: string;
}
export type RuntimeEnv = Env & Secrets;
const settings = (env: RuntimeEnv) => env as unknown as Settings;
export async function authenticated(
  request: Request,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}
export function parseInput(path: string, p: unknown): Source[] {
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new ApiError("INVALID_REQUEST", "A JSON object is required.", 422);
  const obj = p as Record<string, unknown>;
  const mix = path === "/api/mix";
  if (
    Object.keys(obj).some(
      (k) => !(mix ? ["url_1", "url_2", "bias"] : ["url"]).includes(k),
    )
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "The request contains unsupported fields.",
      422,
    );
  if (!mix)
    return [
      { label: "web_1", url: targetUrl(obj.url).href, weight: 100, data: {} },
    ];
  const bias = obj.bias ?? 0;
  if (typeof bias !== "number" || ![-50, -25, 0, 25, 50].includes(bias))
    throw new ApiError(
      "INVALID_REQUEST",
      "Bias must be -50, -25, 0, 25 or 50.",
      422,
    );
  const u1 = targetUrl(obj.url_1).href,
    u2 = targetUrl(obj.url_2).href;
  if (u1.replace(/\/$/, "") === u2.replace(/\/$/, ""))
    throw new ApiError(
      "INVALID_REQUEST",
      "The two source URLs must be different.",
      422,
    );
  return [
    { label: "web_1", url: u1, weight: 50 - bias, data: {} },
    { label: "web_2", url: u2, weight: 50 + bias, data: {} },
  ];
}
export class AnalysisSession extends DurableObject<RuntimeEnv> {
  private running = false;
  async fetch(request: Request): Promise<Response> {
    const { sources, id, bias, captureOnly } = await request.json<{
      sources: Source[];
      id: string;
      bias: number | null;
      captureOnly?: boolean;
    }>();
    const credentials = requestCredentials(request);
    if (!captureOnly && request.headers.get('accept') === 'application/x-ndjson')
      return streamAnalysis(emit => this.run(sources, id, bias, false, credentials, emit));
    return this.run(sources, id, bias, captureOnly, credentials);
  }
  async run(
    sources: Source[],
    id: string,
    bias: number | null,
    captureOnly = false,
    credentials?: ByokCredentials,
    emit?: (progress: AnalysisProgress) => void,
  ): Promise<Response> {
    if (this.running)
      return errorResponse(
        new ApiError(
          "CAPACITY_REACHED",
          "This analysis is already running.",
          503,
          true,
        ),
      );
    this.running = true;
    const baseConfig = config(settings(this.env));
    const c = credentials ? { ...baseConfig, attempts: 1, budgetEnabled: false } : baseConfig;
    const providerEnv = providerSettings(settings(this.env), credentials);
    const cfg = captureOnly
      ? { provider: "capture-diagnostic", model: "none" }
      : providerConfig(providerEnv);
    const quota = this.env.QUOTA.getByName("global-budget-v1");
    const total = AbortSignal.timeout(c.totalMs);
    let browserMs: number | null = 0,
      tokens: number | null = 0;
    let microUsd: number | null = 0;
    let providerSuccess = false;
    let resultReady = false;
    let capturedMs = 0;
    let failure: "transient" | "configuration" | "quota" | undefined,
      retryAfter: number | undefined;
    const metrics: Record<string, unknown>[] = [];
    const started = Date.now();
    let subrequests = 0;
    const relayBudget = new RelayBudget();
    let browserControlCalls = 0;
    const browserControl = { sent_messages: 0, sent_bytes: 0 };
    let providerExternalCalls = 0, generationAttempts = 0, auxiliaryCalls = 0;
    let reportedUsage: AnalysisTelemetry['usage'] = null;
    let completedSteps = 1;
    const activeSources = sources.filter(s => s.weight > 0);
    const totalSteps = activeSources.length + 3;
    let finalTelemetry: AnalysisTelemetry | undefined;
    const telemetry = (final = false): AnalysisTelemetry => ({
      funding: credentials ? 'byok' : 'demo', provider: cfg.provider, model: cfg.model,
      provider_calls: providerExternalCalls, generation_attempts: generationAttempts, auxiliary_calls: auxiliaryCalls,
      final, usage_status: !final ? 'pending' : !providerExternalCalls ? 'not_called' : reportedUsage ? 'reported' : 'unavailable',
      usage: reportedUsage,
      demo_budget: final && !credentials ? {
        tokens_charged_or_reserved: tokens ?? (c.inputTokens + c.outputTokens) * c.attempts,
        micro_usd_charged_or_reserved: microUsd ?? maximumMicroUsd(c),
        conservative: tokens === null || microUsd === null || generationAttempts > 1,
      } : null,
      browser_ms: final ? browserMs : null,
      browser_reserved_ms: !final || browserMs === null ? (c.scrapeMs + 15000) * activeSources.length : 0,
    });
    const progress = (stage: AnalysisProgress['stage'], source: string | null = null) => emit?.({
      stage, source, completed_steps: completedSteps, total_steps: totalSteps,
      percent: Math.floor(completedSteps * 100 / totalSteps), telemetry: telemetry(),
    });
    const measuredFetch: typeof fetch = async (...args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      const auxiliary = url.endsWith(':countTokens');
      subrequests++;
      await quota.providerCall(id, providerExternalCalls + 1, auxiliary ? 'auxiliary' : 'generation');
      subrequests++;
      providerExternalCalls++;
      if (auxiliary) auxiliaryCalls++; else generationAttempts++;
      progress(auxiliary ? 'counting_tokens' : 'analyzing');
      return fetch(...args);
    };
    const browserBinding = {
      fetch: async (...args: Parameters<typeof fetch>) => {
        subrequests++;
        browserControlCalls++;
        const response = await this.env.BROWSER.fetch(...args);
        const socket = response.webSocket;
        if (socket) {
          const send = socket.send.bind(socket);
          socket.send = message => {
            browserControl.sent_messages++;
            browserControl.sent_bytes += typeof message === "string"
              ? new TextEncoder().encode(message).byteLength : message instanceof Blob ? message.size : message.byteLength;
            send(message);
          };
        }
        return response;
      },
    };
    try {
      progress('admitted');
      for (const source of activeSources) {
        progress('capture', source.label);
        subrequests++;
        await sleep(await quota.browserStart(id), total);
        const start = Date.now();
        browserMs = null;
        const captureSignal = AbortSignal.any([
          total,
          AbortSignal.timeout(c.scrapeMs),
        ]);
        const result = await withBrowser(
          browserBinding,
          captureSignal,
          (browser) =>
            capture(
              browser,
              source.url,
              c,
              captureSignal,
              undefined,
              new RelayResources(() => this.env.RESOURCE_RELAY.get(this.env.RESOURCE_RELAY.newUniqueId()),
                captureSignal, start + c.scrapeMs, relayBudget),
            ),
        ).catch((error: unknown) => {
          if (error instanceof ApiError) {
            if (error.browserMs !== undefined) browserMs = capturedMs + error.browserMs;
            if (error.captureMetrics) metrics.push({ ...error.captureMetrics });
          }
          throw error;
        });
        source.screenshot = result.screenshot;
        source.data = result.data;
        metrics.push({ ...result.metrics });
        capturedMs += Date.now() - start;
        browserMs = capturedMs;
        completedSteps++;
        progress('capture', source.label);
      }
      if (captureOnly) {
        console.log(
          JSON.stringify({
            event: "capture_complete",
            id,
            browser_wall_ms: browserMs,
            counted_subrequests: subrequests + relayBudget.calls + 1,
            relay_internal_calls: relayBudget.calls,
            browser_control_calls: browserControlCalls,
            browser_control: browserControl,
            requests: metrics.reduce((sum, m) => sum + Number(m.requests), 0),
            external_hosts: metrics.map((m) => m.external_hosts),
            capture_metrics: metrics,
          }),
        );
        return Response.json(
          {
            success: true,
            kind: "capture-check",
            metrics,
            browser_wall_ms: browserMs,
            counted_subrequests: subrequests + relayBudget.calls + 1,
            relay_internal_calls: relayBudget.calls,
            browser_control_calls: browserControlCalls,
            browser_control: browserControl,
            sources,
          },
          { headers: { "cache-control": "no-store", "x-analysis-id": id } },
        );
      }
      tokens = null;
      microUsd = null;
      let result = await analyze(
        sources,
        providerEnv,
        c,
        total,
        measuredFetch,
        usage => { reportedUsage = usage; },
      );
      reportedUsage = result.usage;
      completedSteps++;
      progress('exporting');
      tokens = result.budgetTokens;
      microUsd = result.budgetMicroUsd;
      let attemptsUsed = result.attempts;
      let system;
      try {
        system = normalize(result.raw, sources);
      } catch (error) {
        // A color left as an unresolvable var() reference is a generation slip,
        // not bad evidence. Spend at most the attempts already reserved for this
        // analysis (BYOK has one) and charge both generations to the budget.
        const remaining = c.attempts - attemptsUsed;
        if ((error as { validationReason?: string }).validationReason !== "unresolved_color_variable" || remaining < 1)
          throw error;
        console.log(JSON.stringify({
          event: "analysis_regenerating", id, reason: "unresolved_color_variable",
          validation_detail: (error as { validationDetail?: unknown }).validationDetail || null,
        }));
        const first = { tokens, microUsd };
        tokens = null;
        microUsd = null;
        try {
          result = await analyze(
            sources,
            providerEnv,
            { ...c, attempts: remaining },
            total,
            measuredFetch,
            usage => { reportedUsage = usage; },
          );
        } catch (retryError) {
          if (retryError instanceof ApiError) {
            retryError.budgetTokens = first.tokens === null || retryError.budgetTokens === undefined
              ? undefined : first.tokens + retryError.budgetTokens;
            retryError.budgetMicroUsd = first.microUsd === null || retryError.budgetMicroUsd === undefined
              ? undefined : first.microUsd + retryError.budgetMicroUsd;
          }
          throw retryError;
        }
        attemptsUsed += result.attempts;
        result.usage.notes.push(
          "An earlier generation was discarded because a color referenced an unresolved CSS variable. Usage describes the final response; the shared budget is charged for both.",
        );
        reportedUsage = result.usage;
        tokens = first.tokens === null || result.budgetTokens === null ? null : first.tokens + result.budgetTokens;
        microUsd = first.microUsd === null || result.budgetMicroUsd === null ? null : first.microUsd + result.budgetMicroUsd;
        system = normalize(result.raw, sources);
      }
      providerSuccess = true;
      const documents = renderDocuments(system);
      const exports = renderExports(system);
      const metadata =
        bias === null
          ? {
              url: sources[0].url,
              title: sources[0].data.title || "",
              description: sources[0].data.description || "",
              colors_extracted: ((sources[0].data.colors as unknown[]) || [])
                .length,
              fonts_extracted: ((sources[0].data.fonts as unknown[]) || [])
                .length,
              usage: result.usage,
            }
          : {
              mode: "mix",
              bias,
              weights: Object.fromEntries(
                sources.map((s) => [s.label, s.weight]),
              ),
              sources: sources.map((s) => ({
                slot: s.label,
                url: s.url,
                influence: s.weight,
                status: s.weight ? "analyzed" : "excluded",
                title: s.data.title || "",
                description: s.data.description || "",
                colors_extracted: ((s.data.colors as unknown[]) || []).length,
                fonts_extracted: ((s.data.fonts as unknown[]) || []).length,
              })),
              usage: result.usage,
            };
      // Explicitly allowlist telemetry. Never emit URLs, page content, prompts, keys or upstream errors.
      console.log(
        JSON.stringify({
          event: "analysis_complete",
          id,
          wall_ms: Date.now() - started,
          browser_wall_ms: browserMs,
          requests: metrics.reduce((sum, m) => sum + Number(m.requests), 0),
          sources: sources.filter((s) => s.weight).length,
          attempts: attemptsUsed,
          tokens: result.usage.total_tokens,
          counted_subrequests: subrequests + relayBudget.calls + 1,
          relay_internal_calls: relayBudget.calls,
          browser_control_calls: browserControlCalls,
          browser_control: browserControl,
          provider_external_calls: providerExternalCalls,
          capture_metrics: metrics,
          external_hosts: metrics.map((m) => m.external_hosts),
        }),
      );
      finalTelemetry = telemetry(true);
      resultReady = true;
      return Response.json(
        {
          telemetry: finalTelemetry,
          success: true,
          design_md: documents.extended,
          design_system: system,
          documents,
          exports,
          metadata,
          error: null,
        },
        { headers: { "cache-control": "no-store", "x-analysis-id": id } },
      );
    } catch (e) {
      const err = total.aborted
        ? new ApiError(
            "ANALYSIS_TIMEOUT",
            "The analysis exceeded its total time limit.",
            504,
            true,
          )
        : e;
      if (err instanceof ApiError) {
        if (err.budgetTokens !== undefined) tokens = err.budgetTokens;
        if (err.budgetMicroUsd !== undefined) microUsd = err.budgetMicroUsd;
        if (
          [
            "PROVIDER_AUTH_ERROR",
            "PROVIDER_MODEL_UNAVAILABLE",
            "PROVIDER_REQUEST_REJECTED",
          ].includes(err.code)
        )
          failure = "configuration";
        else if (err.code === "PROVIDER_QUOTA_EXHAUSTED") {
          failure = "quota";
          retryAfter = err.retryAfter;
        } else if (
          [
            "AI_TIMEOUT",
            "AI_FAILED",
            "PROVIDER_TEMPORARILY_UNAVAILABLE",
          ].includes(err.code)
        )
          failure = "transient";
      }
      console.log(
        JSON.stringify({
          event: "analysis_failed",
          id,
          code: err instanceof ApiError ? err.code : "INTERNAL_ERROR",
          wall_ms: Date.now() - started,
          provider_diagnostic:
            err instanceof ApiError ? err.diagnostic || null : null,
          validation_reason:
            (err as { validationReason?: string })?.validationReason || null,
          validation_detail:
            (err as { validationDetail?: { path: string; value: string } })
              ?.validationDetail || null,
          counted_subrequests: subrequests + relayBudget.calls + 1,
          relay_internal_calls: relayBudget.calls,
          browser_control_calls: browserControlCalls,
          browser_control: browserControl,
          provider_external_calls: providerExternalCalls,
          browser_wall_ms: browserMs,
          tokens,
          capture_metrics: metrics,
        }),
      );
      finalTelemetry = telemetry(true);
      const failureResponse = errorResponse(err);
      const payload = await failureResponse.json() as object;
      return Response.json({ ...payload, telemetry: finalTelemetry }, failureResponse);
    } finally {
      await Promise.resolve(quota.finish(id, {
        browserMs,
        tokens,
        microUsd,
        provider: cfg.provider,
        version: c.providerVersion,
        success: providerSuccess,
        ...(failure ? { failure } : {}),
        ...(retryAfter ? { retryAfter } : {}),
      })).finally(() => { this.running = false; });
      if (finalTelemetry) {
        if (resultReady) completedSteps = totalSteps;
        emit?.({ stage: resultReady ? 'complete' : 'failed', source: null, completed_steps: completedSteps,
          total_steps: totalSteps, percent: Math.floor(completedSteps * 100 / totalSteps), telemetry: finalTelemetry });
      }
    }
  }
}
export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    let response: Response;
    let origins: string[] = [];
    let dispatched = false;
    let rejectedTelemetry: AnalysisTelemetry | undefined;
    if (request.method === 'POST' && ['/api/analyze', '/api/mix'].includes(new URL(request.url).pathname)) {
      rejectedTelemetry = { funding: request.headers.has('x-ai-key') ? 'byok' : 'demo', provider: 'unselected', model: 'unavailable',
        provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0, final: true, usage_status: 'not_called', usage: null,
        demo_budget: null, browser_ms: 0, browser_reserved_ms: 0 };
    }
    try {
      const c = config(settings(env));
      origins = c.origins;
      const path = new URL(request.url).pathname;
      if (request.method === "OPTIONS")
        response = new Response(null, { status: 204 });
      else if (request.method === "GET" && (path === "/health" || path === "/"))
        response = Response.json({ status: "ok", version: "0.10.0" });
      else if (request.method === "GET" && path === "/api/providers")
        response = Response.json({ providers: providerCatalog(settings(env)) });
      else if (request.method === 'GET' && path === '/api/quotas') {
        if (c.requireAuth && !(await authenticated(request, env.PHASE8_AUTH_TOKEN)))
          throw new ApiError('UNAUTHORIZED', 'Authentication is required.', 401);
        response = Response.json(await env.QUOTA.getByName('global-budget-v1').publicStatus());
      }
      else if (request.method === "GET" && path === "/api/session") {
        if (c.requireAuth && !(await authenticated(request, env.PHASE8_AUTH_TOKEN)))
          throw new ApiError("UNAUTHORIZED", "A valid preview access code is required.", 401);
        response = Response.json({ authenticated: true });
      }
      else if (request.method === "GET" && path === "/api/diagnostics/budget") {
        if (!(await authenticated(request, env.PHASE8_AUTH_TOKEN)))
          throw new ApiError("UNAUTHORIZED", "Administrative authentication is required.", 401);
        response = Response.json(await env.QUOTA.getByName("global-budget-v1").status());
      }
      else {
        const captureOnly =
          c.requireAuth &&
          ["/api/diagnostics/capture", "/api/diagnostics/capture-mix"].includes(
            path,
          );
        if (!["/api/analyze", "/api/mix"].includes(path) && !captureOnly)
          throw new ApiError("NOT_FOUND", "Not found.", 404);
        if (request.method !== "POST")
          throw new ApiError("METHOD_NOT_ALLOWED", "POST is required.", 405);
        if (
          c.requireAuth &&
          !(await authenticated(request, env.PHASE8_AUTH_TOKEN))
        )
          throw new ApiError(
            "UNAUTHORIZED",
            "A valid preview access code is required.",
            401,
          );
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.startsWith("application/json"))
          throw new ApiError(
            "INVALID_REQUEST",
            "Content-Type must be application/json.",
            415,
          );
        const text = await boundedText(
          new Response(request.body, { headers: request.headers }),
          16384,
          AbortSignal.timeout(5000),
        );
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError(
            "INVALID_REQUEST",
            "The body must contain valid JSON.",
            422,
          );
        }
        const mix =
          path === "/api/mix" || path === "/api/diagnostics/capture-mix";
        const sources = parseInput(mix ? "/api/mix" : "/api/analyze", body);
        const credentials = requestCredentials(request);
        const cfg = captureOnly
          ? { provider: "capture-diagnostic" }
          : providerConfig(providerSettings(settings(env), credentials));
        if (rejectedTelemetry && 'model' in cfg) { rejectedTelemetry.provider = cfg.provider; rejectedTelemetry.model = cfg.model; }
        const ip = request.headers.get("cf-connecting-ip");
        if (!ip || !env.IP_HASH_SECRET)
          throw new ApiError(
            "CONFIGURATION_ERROR",
            "Client identification is unavailable.",
            503,
          );
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(env.IP_HASH_SECRET),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const hash = await crypto.subtle.sign(
          "HMAC",
          key,
          new TextEncoder().encode(ip),
        );
        const hashedIp = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        const id = crypto.randomUUID();
        const quota = env.QUOTA.getByName("global-budget-v1");
        const admission = await quota.admit({
          id,
          ip: hashedIp,
          sources: sources.filter((s) => s.weight).length,
          provider: cfg.provider,
          version: c.providerVersion,
          funding: credentials ? "byok" : "demo",
        });
        if (!admission.ok)
          throw new ApiError(
            admission.code,
            ({
              RATE_LIMITED: "This IP has reached its hourly analysis limit.",
              IP_DAILY_LIMIT_REACHED: "This IP has reached its daily analysis limit. It resets at 00:00 UTC.",
              DAILY_LIMIT_REACHED: "The shared daily analysis quota is exhausted. It resets at 00:00 UTC.",
              BROWSER_QUOTA_EXHAUSTED: "Today's capture budget is exhausted. It resets at 00:00 UTC.",
              DAILY_AI_BUDGET_EXHAUSTED: "Today's estimated AI budget is exhausted. It resets at 00:00 UTC.",
              PROJECT_BUDGET_EXHAUSTED: "The demo's estimated AI budget is exhausted. The owner needs to review it.",
              AI_BUDGET_REACHED: "Today's AI token allowance is exhausted. It resets at 00:00 UTC.",
              CAPACITY_REACHED: "Another analysis is running. Please retry shortly.",
              PROVIDER_UNAVAILABLE: "The shared AI provider needs the owner's attention. Use your own key or try again after the configuration is repaired.",
              PROVIDER_CIRCUIT_OPEN: "The shared AI provider is recovering from recent failures. Please wait before retrying.",
            } as Record<string, string>)[admission.code] || "The service has reached an operational limit. Please retry later.",
            admission.status,
            !["PROJECT_BUDGET_EXHAUSTED", "PROVIDER_UNAVAILABLE"].includes(admission.code),
            ["PROJECT_BUDGET_EXHAUSTED", "PROVIDER_UNAVAILABLE"].includes(admission.code) ? undefined : admission.retryAfter,
          );
        try {
          dispatched = true;
          response = await env.ANALYSIS.getByName(id).fetch(
            "https://analysis.internal/run",
            {
              method: "POST",
              headers: {
                ...(credentials ? { 'x-ai-provider': credentials.provider, 'x-ai-key': credentials.key } : {}),
                ...(request.headers.get('accept') === 'application/x-ndjson' ? { accept: 'application/x-ndjson' } : {}),
              },
              body: JSON.stringify({
                sources,
                id,
                captureOnly,
                bias: mix
                  ? Number((body as { bias?: number }).bias || 0)
                  : null,
              }),
            },
          );
        } catch {
          throw new ApiError(
            "ANALYSIS_UNAVAILABLE",
            "The analysis runtime is temporarily unavailable.",
            503,
            true,
          );
        }
      }
    } catch (e) {
      response = errorResponse(e);
      if (rejectedTelemetry && !dispatched) response = Response.json({ ...await response.json() as object, telemetry: rejectedTelemetry }, response);
    }
    const result = new Response(response.body, response);
    const origin = request.headers.get("origin");
    result.headers.set("vary", "Origin");
    result.headers.set("cache-control", response.headers.get("content-type")?.includes("application/x-ndjson") ? "no-store, no-transform" : "no-store");
    if (origin && origins.includes(origin)) {
      result.headers.set("access-control-allow-origin", origin);
      result.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
      result.headers.set(
        "access-control-allow-headers",
        "Content-Type, Authorization, X-AI-Provider, X-AI-Key",
      );
      result.headers.set(
        "access-control-expose-headers",
        "Retry-After, X-Analysis-Id",
      );
    }
    return result;
  },
} satisfies ExportedHandler<RuntimeEnv>;
