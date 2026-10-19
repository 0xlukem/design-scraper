import { it, expect, vi, afterEach } from "vitest";
import {
  analyze,
  providerRequest,
  providerConfig,
  classifyProviderError,
} from "../src/providers";
import { config } from "../src/config";
import fixtures from "./fixtures/contracts.json";
import type { Source } from "../src/domain/normalize";
const env = { GEMINI_API_KEY: "unit-secret", GEMINI_MODEL: "gemini-3.6-flash" };
const c = config(env);
const meteredEnv = { ...env, AI_BUDGET_ENABLED: "true", AI_INPUT_PRICE_USD_PER_MILLION: "0.75", AI_OUTPUT_PRICE_USD_PER_MILLION: "3.75" };
const sources = fixtures[0].sources.map((s) => ({
  ...s,
  screenshot: "YWJj",
})) as Source[];
const geminiRaw = (raw: Record<string, unknown>) =>
  JSON.stringify({
    design: Object.fromEntries(
      Object.entries(raw).filter(([k]) =>
        [
          "metadata",
          "overview",
          "colors",
          "typography",
          "spacing",
          "layout",
          "elevation",
          "shapes",
          "components",
        ].includes(k),
      ),
    ),
    guidance: Object.fromEntries(
      Object.entries(raw).filter(
        ([k]) =>
          ![
            "metadata",
            "overview",
            "colors",
            "typography",
            "spacing",
            "layout",
            "elevation",
            "shapes",
            "components",
          ].includes(k),
      ),
    ),
  });
const success = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: geminiRaw(fixtures[0].raw) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 2000,
      candidatesTokenCount: 3000,
      totalTokenCount: 5100,
      thoughtsTokenCount: 100,
    },
  });
afterEach(() => vi.useRealTimers());
it("recovers after 503 without recapturing and keeps the key out of URLs", async () => {
  vi.useFakeTimers();
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            status: "UNAVAILABLE",
            message: "secret should never escape",
          },
        },
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(success());
  const promise = analyze(sources, env, c, new AbortController().signal, f);
  await vi.runAllTimersAsync();
  const result = await promise;
  expect(f).toHaveBeenCalledTimes(2);
  expect(result.attempts).toBe(2);
  expect(result.usage.status).toBe("exact");
  expect(result.budgetTokens).toBe(62100);
  expect(String(f.mock.calls[0][0])).not.toContain("unit-secret");
  expect(f.mock.calls[0][1].headers.get("x-goog-api-key")).toBe("unit-secret");
  expect(f.mock.calls[0][1].body).toBe(f.mock.calls[1][1].body);
});
it("does not retry authentication errors or exhausted quota", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const f = vi.fn(async () =>
      Response.json(
        { error: { details: [{ reason: "API_KEY_INVALID" }] } },
        { status },
      ),
    );
    await expect(
      analyze(sources, env, c, new AbortController().signal, f),
    ).rejects.toBeInstanceOf(Error);
    expect(f).toHaveBeenCalledTimes(1);
  }
});
it("distinguishes credentials, model, quota and transient failures", () => {
  expect(classifyProviderError(403, null, null).code).toBe(
    "PROVIDER_AUTH_ERROR",
  );
  expect(classifyProviderError(404, null, null).code).toBe(
    "PROVIDER_MODEL_UNAVAILABLE",
  );
  expect(classifyProviderError(429, null, "120").retryAfter).toBe(120);
  expect(classifyProviderError(503, null, null).retryable).toBe(true);
});
it.each([
  [401, "PROVIDER_AUTH_ERROR"],
  [403, "PROVIDER_AUTH_ERROR"],
  [404, "PROVIDER_MODEL_UNAVAILABLE"],
  [429, "PROVIDER_QUOTA_EXHAUSTED"],
] as const)("preserves HTTP %s when the provider returns a non-JSON error", async (status, code) => {
  const f = vi.fn(async () => new Response("<html>private-provider-text unit-secret</html>", {
    status, headers: { "retry-after": "120" },
  }));
  await expect(analyze(sources, env, c, new AbortController().signal, f)).rejects.toMatchObject({ code });
  expect(f).toHaveBeenCalledTimes(1);
  if (status === 429)
    await expect(analyze(sources, env, c, new AbortController().signal, f)).rejects.toMatchObject({ retryAfter: 120 });
});
it("retries an HTML gateway failure within the existing attempt budget", async () => {
  vi.useFakeTimers();
  const f = vi.fn().mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }))
    .mockResolvedValueOnce(success());
  const run = analyze(sources, env, c, new AbortController().signal, f);
  await vi.runAllTimersAsync();
  const result = await run;
  expect(result.attempts).toBe(2);
  expect(result.budgetTokens).toBe(c.inputTokens + c.outputTokens + 5100);
  expect(f).toHaveBeenCalledTimes(2);
});
it.each(["oversized", "unreadable"])("preserves HTTP errors when their bodies are %s", async kind => {
  for (const status of [401, 429]) {
    const f = vi.fn(async () => kind === "oversized"
      ? new Response("x".repeat(750001), { status })
      : new Response(new ReadableStream({ start(controller) { controller.error(new Error("private upstream body")); } }), { status }));
    await expect(analyze(sources, env, c, new AbortController().signal, f)).rejects.toMatchObject({
      code: classifyProviderError(status, null, null).code,
    });
    expect(f).toHaveBeenCalledTimes(1);
  }
});
it.each([401, 429, 503])("preserves token-count HTTP %s errors and never dispatches generation", async status => {
  const f = vi.fn(async () => new Response("", { status, headers: { "retry-after": "120" } }));
  const run = analyze(sources, meteredEnv, config(meteredEnv), new AbortController().signal, f);
  await expect(run).rejects.toMatchObject({
    code: classifyProviderError(status, null, "120").code,
    budgetTokens: 0,
    budgetMicroUsd: 0,
  });
  expect(f).toHaveBeenCalledTimes(1);
});
it.each([null, [], "invalid", 42])("rejects a malformed successful provider envelope (%j) with a safe error", async payload => {
  const f = vi.fn(async () => Response.json(payload));
  await expect(analyze(sources, env, c, new AbortController().signal, f)).rejects.toMatchObject({
    code: "AI_FAILED", message: "The AI provider returned an invalid response.",
  });
  expect(f).toHaveBeenCalledTimes(1);
});
it.each([
  { candidates: {} },
  { candidates: [null] },
  { candidates: [{ content: { parts: {} } }] },
])("returns a safe provider error for malformed candidate data (%j)", async payload => {
  await expect(analyze(sources, env, c, new AbortController().signal, vi.fn(async () => Response.json(payload))))
    .rejects.toMatchObject({ code: "AI_FAILED", message: "The AI provider returned an invalid response." });
});
it("uses estimates for missing usage and never invents pricing", async () => {
  const f = vi.fn(async () =>
    Response.json({
      candidates: [
        { content: { parts: [{ text: geminiRaw(fixtures[0].raw) }] } },
      ],
    }),
  );
  const r = await analyze(sources, env, c, new AbortController().signal, f);
  expect(r.usage.status).toBe("estimated");
  expect(r.usage.cost_status).toBe("unavailable");
  expect(r.usage.estimated_cost_usd).toBeNull();
  expect(r.budgetTokens).toBeNull();
});
it.each([{}, [], 123, " ", "x".repeat(201)])("uses the configured model when reported model metadata is malformed (%j)", async modelVersion => {
  const payload = await success().json();
  const result = await analyze(sources, env, c, new AbortController().signal,
    vi.fn(async () => Response.json({ ...payload as object, modelVersion })));
  expect(result.usage.model).toBe(env.GEMINI_MODEL);
});
it("rejects empty and truncated provider outputs", async () => {
  for (const p of [
    { candidates: [] },
    {
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } },
      ],
    },
  ])
    await expect(
      analyze(
        sources,
        env,
        c,
        new AbortController().signal,
        vi.fn(async () => Response.json(p)),
      ),
    ).rejects.toMatchObject({ code: "AI_FAILED" });
});
it.each(["gemini", "anthropic", "openai", "xai"] as const)(
  "retains the multimodal adapter for %s",
  (provider) => {
    const req = providerRequest(
      provider,
      "secret",
      "model",
      "prompt",
      ["a", "b"],
      c,
    );
    expect(req.url).toMatch(/^https:/);
    expect(JSON.stringify(req.body)).toContain("image");
    expect(JSON.stringify(req.body)).not.toContain("secret");
  },
);
it("resolves aliases and fails before capture when keys are absent", () => {
  expect(
    providerConfig({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "s" }).provider,
  ).toBe("anthropic");
  expect(() => providerConfig({})).toThrow();
});
it("recovers from a timed-out first attempt within the shared deadline", async () => {
  const cfg = config({
    ...env,
    AI_ATTEMPT_TIMEOUT_MS: "1000",
    AI_TIMEOUT_MS: "5000",
  });
  const f = vi
    .fn()
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          ),
        ),
    )
    .mockResolvedValueOnce(success());
  const result = await analyze(
    sources,
    env,
    cfg,
    new AbortController().signal,
    f,
  );
  expect(result.attempts).toBe(2);
  expect(f).toHaveBeenCalledTimes(2);
});
it("stops immediately on the total analysis deadline", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = vi.fn();
  await expect(
    analyze(sources, env, c, controller.signal, f),
  ).rejects.toMatchObject({ code: "ANALYSIS_TIMEOUT" });
  expect(f).not.toHaveBeenCalled();
});
it("does not expose provider text on an exhausted transient retry", async () => {
  vi.useFakeTimers();
  const f = vi.fn(async () =>
    Response.json(
      { error: { message: "private-provider-text unit-secret" } },
      { status: 503 },
    ),
  );
  const run = expect(
    analyze(sources, env, c, new AbortController().signal, f),
  ).rejects.toMatchObject({
    code: "PROVIDER_TEMPORARILY_UNAVAILABLE",
    message: "The AI provider is temporarily unavailable.",
  });
  await vi.runAllTimersAsync();
  await run;
  expect(f).toHaveBeenCalledTimes(2);
});
it.each(["anthropic", "openai", "xai"] as const)(
  "normalizes successful usage for %s",
  async (provider) => {
    const e = {
      AI_PROVIDER: provider,
      [provider.toUpperCase() + "_API_KEY"]: "unit-secret",
    };
    const response =
      provider === "anthropic"
        ? {
            model: "configured",
            content: [{ type: "text", text: "{}" }],
            usage: { input_tokens: 10, output_tokens: 20 },
          }
        : provider === "openai"
          ? {
              model: "configured",
              output: [{ content: [{ type: "output_text", text: "{}" }] }],
              usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
            }
          : {
              model: "configured",
              choices: [{ message: { content: "{}" } }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30,
              },
            };
    const result = await analyze(
      sources,
      e,
      c,
      new AbortController().signal,
      vi.fn(async () => Response.json(response)),
    );
    expect(result.usage).toMatchObject({
      provider,
      status: "exact",
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });
  },
);
import { withBrowser } from "../src/browser-session";
import { ApiError } from "../src/errors";
it("propagates the capture deadline into browser acquisition", async () => {
  const controller = new AbortController();
  const f = vi.fn(async (_input, init) => {
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
    return new Response();
  });
  const close = vi.fn(async () => {});
  const launcher = vi.fn(async (binding) => {
    await binding.fetch("https://browser.internal/acquire");
    return { close };
  });
  await withBrowser(
    { fetch: f as typeof fetch },
    controller.signal,
    async () => "captured",
    launcher as never,
  );
  expect(close).toHaveBeenCalledTimes(1);
});
it("closes the browser when capture fails", async () => {
  const close = vi.fn(async () => {});
  await expect(
    withBrowser(
      { fetch },
      new AbortController().signal,
      async () => {
        throw new Error("unsafe page text");
      },
      vi.fn(async () => ({ close })) as never,
    ),
  ).rejects.toMatchObject({ code: "SCRAPE_FAILED" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps an acquired browser transport alive until explicit timeout cleanup", async () => {
  const controller = new AbortController();
  let acquisitionSignal: AbortSignal | undefined;
  const binding = { fetch: vi.fn(async (_input, init) => {
    acquisitionSignal = init?.signal as AbortSignal;
    return new Response();
  }) as typeof fetch };
  const close = vi.fn(async () => {
    expect(controller.signal.aborted).toBe(true);
    expect(acquisitionSignal?.aborted).toBe(false);
  });
  await expect(withBrowser(binding, controller.signal, async () => {
    controller.abort();
    controller.signal.throwIfAborted();
  }, vi.fn(async b => {
    await b.fetch("https://browser.internal/connect");
    return {close};
  }) as never)).rejects.toMatchObject({code:"SCRAPE_TIMEOUT"});
  expect(close).toHaveBeenCalledTimes(1);
});

it("still cancels browser acquisition when its deadline expires", async () => {
  const controller = new AbortController();
  let acquisitionSignal: AbortSignal | undefined;
  await expect(withBrowser({fetch: vi.fn(async (_input, init) => {
    acquisitionSignal = init?.signal as AbortSignal;
    controller.abort();
    acquisitionSignal.throwIfAborted();
    return new Response();
  }) as typeof fetch}, controller.signal, async () => "unreachable",
  vi.fn(async b => {
    await b.fetch("https://browser.internal/acquire");
    throw new Error("unreachable");
  }) as never)).rejects.toMatchObject({code:"SCRAPE_TIMEOUT"});
  expect(acquisitionSignal?.aborted).toBe(true);
});

it("does not charge a rejected configuration as generated tokens", async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: { message: "schema is too complex" } },
      { status: 400 },
    ),
  );
  await expect(
    analyze(
      sources,
      env,
      config({}),
      AbortSignal.timeout(10000),
      fetcher as typeof fetch,
    ),
  ).rejects.toMatchObject({
    code: "PROVIDER_REQUEST_REJECTED",
    budgetTokens: 0,
    diagnostic: "schema,complex",
  });
});

it("counts the complete Gemini input before generation and accounts for reasoning", async () => {
  const f = vi.fn().mockResolvedValueOnce(Response.json({ totalTokens: 2000 })).mockResolvedValueOnce(success());
  const result = await analyze(sources, meteredEnv, config(meteredEnv), new AbortController().signal, f);
  expect(String(f.mock.calls[0][0])).toMatch(/:countTokens$/);
  const counted = JSON.parse(f.mock.calls[0][1].body).generateContentRequest;
  const generated = JSON.parse(f.mock.calls[1][1].body);
  expect(counted).toEqual({ ...generated, model: `models/${env.GEMINI_MODEL}` });
  expect(result.budgetMicroUsd).toBe(13125);
});
it("includes reported Gemini reasoning in the token budget when its total is absent", async () => {
  const payload = await success().json() as { usageMetadata: Record<string, number> };
  delete payload.usageMetadata.totalTokenCount;
  const result = await analyze(sources, env, c, new AbortController().signal, vi.fn(async () => Response.json(payload)));
  expect(result.usage.total_tokens).toBe(5100);
  expect(result.budgetTokens).toBe(5100);
});
it.each([{ totalTokens: 45000 }, {}, { totalTokens: -1 }])("never generates when the input budget cannot be verified (%j)", async payload => {
  const f = vi.fn(async () => Response.json(payload));
  await expect(analyze(sources, meteredEnv, config(meteredEnv), new AbortController().signal, f))
    .rejects.toMatchObject({ budgetTokens: 0, budgetMicroUsd: 0 });
  expect(f).toHaveBeenCalledTimes(1);
});
it("retains the monetary reservation when successful output omits usage", async () => {
  const f = vi.fn().mockResolvedValueOnce(Response.json({ totalTokens: 2000 }))
    .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: geminiRaw(fixtures[0].raw) }] } }] }));
  const result = await analyze(sources, meteredEnv, config(meteredEnv), new AbortController().signal, f);
  expect(result.budgetMicroUsd).toBeNull();
  expect(result.budgetTokens).toBeNull();
});
it("includes a conservative monetary charge for a failed attempt before success", async () => {
  vi.useFakeTimers();
  const f = vi.fn().mockResolvedValueOnce(Response.json({ totalTokens: 2000 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(success());
  const promise = analyze(sources, meteredEnv, config(meteredEnv), new AbortController().signal, f);
  await vi.runAllTimersAsync();
  expect((await promise).budgetMicroUsd).toBe(78750 + 13125);
});

it("reports measured browser time only when failed capture teardown is confirmed", async () => {
  const failure = new ApiError('SCRAPE_REQUEST_LIMIT', 'Request limit', 422);
  await expect(withBrowser({fetch}, new AbortController().signal, async () => { throw failure; },
    vi.fn(async () => ({close: vi.fn(async () => {})})) as never))
    .rejects.toMatchObject({code:'SCRAPE_REQUEST_LIMIT', browserMs: expect.any(Number)});
  const uncertain = new ApiError('SCRAPE_FAILED', 'Failure', 502);
  await expect(withBrowser({fetch}, new AbortController().signal, async () => { throw uncertain; },
    vi.fn(async () => ({close: vi.fn(async () => {throw new Error('close failed');})})) as never))
    .rejects.toMatchObject({code:'BROWSER_CLOSE_FAILED'});
  expect(uncertain.browserMs).toBeUndefined();
  const relayUncertain = new ApiError('BROWSER_CLOSE_FAILED', 'Relay cleanup unconfirmed', 503);
  await expect(withBrowser({fetch}, new AbortController().signal, async () => { throw relayUncertain; },
    vi.fn(async () => ({close: vi.fn(async () => {})})) as never))
    .rejects.toMatchObject({code:'BROWSER_CLOSE_FAILED'});
  expect(relayUncertain.browserMs).toBeUndefined();
});
