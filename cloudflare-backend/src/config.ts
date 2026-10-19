import { ApiError } from "./errors";
export type Settings = Record<string, string | undefined>;
export function integer(
  env: Settings,
  name: string,
  fallback: number,
  min = 1,
  max = 1e9,
): number {
  const v = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(v) || v < min || v > max)
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The service configuration is invalid.",
      503,
    );
  return v;
}
export function config(env: Settings) {
  const origins = (env.ALLOWED_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((x) => x.trim());
  for (const origin of origins) {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new ApiError(
        "CONFIGURATION_ERROR",
        "Invalid origin configuration.",
        503,
      );
    }
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.origin !== origin ||
      u.username ||
      u.password
    )
      throw new ApiError(
        "CONFIGURATION_ERROR",
        "Invalid origin configuration.",
        503,
      );
  }
  const c = {
    origins,
    requireAuth: env.REQUIRE_AUTH !== "false",
    daily: integer(env, "GLOBAL_DAILY_LIMIT", 10),
    ipHourly: integer(env, "IP_HOURLY_LIMIT", 3),
    ipDaily: integer(env, "IP_DAILY_LIMIT", 5),
    budgetEnabled: env.AI_BUDGET_ENABLED === "true",
    dailyMicroUsd: integer(env, "DAILY_AI_BUDGET_MICRO_USD", 1000000),
    totalMicroUsd: integer(env, "TOTAL_AI_BUDGET_MICRO_USD", 30000000),
    inputPrice: Number(env.AI_INPUT_PRICE_USD_PER_MILLION || 0),
    outputPrice: Number(env.AI_OUTPUT_PRICE_USD_PER_MILLION || 0),
    concurrency: integer(env, "MAX_CONCURRENT_ANALYSES", 1, 1, 3),
    browserDaily: integer(env, "BROWSER_DAILY_MS", 480000),
    startInterval: integer(env, "BROWSER_START_INTERVAL_MS", 21000),
    scrapeMs: integer(env, "SCRAPE_TIMEOUT_MS", 25000, 1000, 60000),
    aiMs: integer(env, "AI_TIMEOUT_MS", 100000, 1000, 180000),
    attemptMs: integer(env, "AI_ATTEMPT_TIMEOUT_MS", 60000, 1000, 120000),
    totalMs: integer(env, "ANALYSIS_TIMEOUT_MS", 180000, 1000, 300000),
    attempts: integer(env, "MAX_AI_ATTEMPTS", 2, 1, 3),
    elements: integer(env, "MAX_ELEMENTS", 3000, 10, 5000),
    requests: integer(env, "MAX_NETWORK_REQUESTS", 200, 1, 600),
    redirects: integer(env, "MAX_REDIRECTS", 5, 0, 10),
    height: integer(env, "MAX_SCREENSHOT_HEIGHT", 4000, 900, 12000),
    screenshotBytes: integer(
      env,
      "MAX_SCREENSHOT_BYTES",
      2000000,
      10000,
      6000000,
    ),
    outputTokens: integer(env, "MAX_OUTPUT_TOKENS", 12000, 1000, 20000),
    inputTokens: integer(env, "MAX_INPUT_TOKENS", 45000, 1000, 100000),
    dailyTokens: integer(env, "DAILY_AI_TOKEN_LIMIT", 150000),
    failureThreshold: integer(env, "PROVIDER_FAILURE_THRESHOLD", 3),
    cooldown: integer(env, "PROVIDER_COOLDOWN_MS", 60000),
    providerVersion: env.PROVIDER_CONFIG_VERSION || "1",
  };
  if (c.budgetEnabled && (
    !env.AI_INPUT_PRICE_USD_PER_MILLION || !env.AI_OUTPUT_PRICE_USD_PER_MILLION ||
    !Number.isFinite(c.inputPrice) || !Number.isFinite(c.outputPrice) ||
    c.inputPrice <= 0 || c.outputPrice <= 0 ||
    (env.AI_PROVIDER || "gemini") !== "gemini"
  )) throw new ApiError("CONFIGURATION_ERROR", "The demo budget requires configured Gemini pricing.", 503);
  if (c.totalMs < c.aiMs + c.scrapeMs * 2)
    throw new ApiError(
      "CONFIGURATION_ERROR",
      "The total deadline must allow capture and provider deadlines.",
      503,
    );
  return c;
}
export type Config = ReturnType<typeof config>;
