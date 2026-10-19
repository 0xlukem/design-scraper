import { it, expect } from "vitest";
import { designKeys, guidanceKeys, unpackGemini } from "../src/gemini-schema";
import fixtures from "./fixtures/contracts.json";
import { geminiDailyRetrySeconds } from "../src/provider-quota";
import { classifyProviderError } from "../src/providers";
it("reassembles every section without changing any fixture value", () => {
  for (const f of fixtures) {
    const part = (keys: string[]) =>
      Object.fromEntries(
        Object.entries(f.raw).filter(([k]) => keys.includes(k)),
      );
    expect(
      JSON.parse(
        unpackGemini(
          JSON.stringify({
            design: part(designKeys),
            guidance: part(guidanceKeys),
          }),
        ),
      ),
    ).toEqual(f.raw);
  }
});
it("rejects cross-group overrides and incomplete envelopes", () => {
  expect(() =>
    unpackGemini('{"design":{},"guidance":{"colors":{}}}'),
  ).toThrow();
  expect(() => unpackGemini('{"design":{}}')).toThrow();
});
it.each([
  ["2026-09-09T17:00:00Z", "2026-09-10T07:00:00Z"],
  ["2026-03-08T08:30:00Z", "2026-03-09T07:00:00Z"],
  ["2026-11-01T07:30:00Z", "2026-11-02T08:00:00Z"],
])("uses the Pacific daily reset including DST: %s", (now, next) => {
  expect(geminiDailyRetrySeconds(Date.parse(now))).toBe(
    (Date.parse(next) - Date.parse(now)) / 1000,
  );
});
it("does not advertise a one-minute retry when Gemini exhausted the daily quota", () => {
  const e = classifyProviderError(
    429,
    {
      error: {
        details: [
          {
            violations: [
              { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" },
            ],
          },
        ],
      },
    },
    "47",
  );
  expect(e.retryAfter).toBe(geminiDailyRetrySeconds());
  expect(e.message).toContain("daily");
});

it("pauses an exhausted provider before browser admission and recovers after reset", async () => {
  const { providerConfig } = await import("../src/providers");
  expect(() =>
    providerConfig({
      GEMINI_API_KEY: "test",
      GEMINI_PAUSED_UNTIL: new Date(Date.now() + 60000).toISOString(),
    }),
  ).toThrow(
    expect.objectContaining({ code: "PROVIDER_QUOTA_EXHAUSTED", status: 429 }),
  );
  expect(
    providerConfig({
      GEMINI_API_KEY: "test",
      GEMINI_PAUSED_UNTIL: "2020-01-01T00:00:00Z",
    }).provider,
  ).toBe("gemini");
  expect(() =>
    providerConfig({ GEMINI_API_KEY: "test", GEMINI_PAUSED_UNTIL: "invalid" }),
  ).toThrow();
});


it("still rejects nested invalid domain values after decoding the relaxed generation envelope", async () => {
  const {normalize} = await import('../src/domain/normalize');
  const broken = structuredClone(fixtures[0].raw);
  broken.colors.brand[0].confidence = 2;
  const part = (keys: string[]) => Object.fromEntries(Object.entries(broken).filter(([k]) => keys.includes(k)));
  const raw = unpackGemini(JSON.stringify({design:part(designKeys),guidance:part(guidanceKeys)}));
  expect(() => normalize(raw, fixtures[0].sources as import('../src/domain/normalize').Source[])).toThrow();
});
