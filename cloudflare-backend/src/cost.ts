import type { Config } from "./config";

// A USD-per-million-token price is also the price in micro-USD per token.
// Keep this pure so provider replay tools can run without the Workers runtime.
export const estimateMicroUsd = (input: number, output: number, c: Config) =>
  Math.ceil(input * c.inputPrice + output * c.outputPrice);

export const maximumMicroUsd = (c: Config) =>
  c.budgetEnabled
    ? estimateMicroUsd(c.inputTokens, c.outputTokens, c) * c.attempts
    : 0;
