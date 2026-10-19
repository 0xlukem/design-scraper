import type { Settings } from "./config";
import { ApiError } from "./errors";
import { providerConfig, type Provider } from "./providers";

export interface ByokCredentials {
  provider: Provider;
  key: string;
}
export const providers: Provider[] = ["gemini", "anthropic", "openai", "xai"];

// Only these two headers select BYOK. Missing/invalid pairs never fall back to
// the shared credential. Administrative Authorization remains independent.
export function requestCredentials(request: Request): ByokCredentials | undefined {
  const provider = request.headers.get("x-ai-provider");
  const key = request.headers.get("x-ai-key");
  if (provider === null && key === null) return;
  if (new URL(request.url).protocol !== "https:")
    throw new ApiError("BYOK_HTTPS_REQUIRED", "Using your own key requires HTTPS.", 400);
  if (!providers.includes(provider as Provider))
    throw new ApiError("BYOK_INVALID_PROVIDER", "Choose Gemini, Anthropic, OpenAI or xAI.", 422);
  if (!key || !/^[\x21-\x7e]{8,512}$/.test(key))
    throw new ApiError("BYOK_INVALID_KEY", "Enter a valid provider key (8–512 characters, without spaces).", 422);
  return { provider: provider as Provider, key };
}

// Request-scoped settings. Do not mutate Env or copy any other user's/shared
// secrets. Only a matching provider/model pair may reuse configured pricing.
export function providerSettings(env: Settings, credentials?: ByokCredentials): Settings {
  if (!credentials) return env;
  const prefix = credentials.provider.toUpperCase();
  const shared = ({ claude: "anthropic", grok: "xai" }[env.AI_PROVIDER || ""] || env.AI_PROVIDER || "gemini");
  return {
    AI_PROVIDER: credentials.provider,
    [prefix + "_API_KEY"]: credentials.key,
    [prefix + "_MODEL"]: env[prefix + "_MODEL"],
    AI_FUNDING: "byok",
    AI_INPUT_PRICE_USD_PER_MILLION: shared === credentials.provider ? env.AI_INPUT_PRICE_USD_PER_MILLION : undefined,
    AI_OUTPUT_PRICE_USD_PER_MILLION: shared === credentials.provider ? env.AI_OUTPUT_PRICE_USD_PER_MILLION : undefined,
  };
}

export function providerCatalog(env: Settings) {
  return providers.map(provider => {
    // The placeholder is used only to resolve non-secret configuration, never
    // sent to a provider, returned to a client or persisted.
    const scoped = providerSettings(env, { provider, key: "catalog-only" });
    const { model } = providerConfig(scoped);
    const input = Number(scoped.AI_INPUT_PRICE_USD_PER_MILLION);
    const output = Number(scoped.AI_OUTPUT_PRICE_USD_PER_MILLION);
    const priced = Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
    return { provider, model, inputPrice: priced ? input : null, outputPrice: priced ? output : null };
  });
}
