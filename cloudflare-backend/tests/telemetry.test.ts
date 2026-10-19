import { afterEach, expect, it, vi } from 'vitest';
import { AnalysisSession, type RuntimeEnv } from '../src/index';
import { capture } from '../src/capture';
import { ApiError } from '../src/errors';
import { config } from '../src/config';
import { newState, reserve, recordProviderCall, settle } from '../src/quota';
import fixtures from './fixtures/contracts.json';
import type { Source } from '../src/domain/normalize';
import type { AnalysisProgress } from '../src/telemetry-contract';
vi.mock('../src/browser-session', () => ({ withBrowser: vi.fn(async (_b, _s, callback) => callback({})) }));
vi.mock('../src/capture', () => ({ capture: vi.fn(async () => ({ screenshot: 'YWJj', data: fixtures[0].sources[0].data, metrics: { requests: 1 } })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const sources = () => structuredClone(fixtures[0].sources) as Source[];
function setup() {
  const providerCall = vi.fn(async () => {}), finish = vi.fn(async () => {});
  const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fake-shared', MAX_AI_ATTEMPTS: '2', QUOTA: { getByName: () => ({ providerCall, finish, browserStart: async () => 0 }) }, BROWSER: { fetch: vi.fn() } } as unknown as RuntimeEnv;
  const session = new AnalysisSession({ storage: {} } as DurableObjectState, env);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return { session, providerCall, finish };
}
const success = () => Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(fixtures[0].raw) }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
it('streams admission before capture completes, then reports actual steps and usage without credentials', async () => {
  const { session, providerCall, finish } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(capture).mockImplementationOnce(async () => { await gate; return { screenshot: 'YWJj', data: fixtures[0].sources[0].data, metrics: {} } as never; });
  vi.stubGlobal('fetch', vi.fn(async () => success()));
  const response = await session.fetch(new Request('https://analysis.internal/run', { method: 'POST', headers: { accept: 'application/x-ndjson', 'x-ai-provider': 'openai', 'x-ai-key': 'fake-private-byok' }, body: JSON.stringify({ sources: sources(), id: 'one', bias: null }) }));
  expect(response.headers.get('content-type')).toBe('application/x-ndjson');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(JSON.parse(first).progress).toMatchObject({ stage: 'admitted', completed_steps: 1, total_steps: 4, percent: 25 });
  expect(finish).not.toHaveBeenCalled();
  release();
  let text = first;
  while (true) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({ type: 'result', payload: { telemetry: { provider_calls: 1, generation_attempts: 1, auxiliary_calls: 0, final: true, usage_status: 'reported', demo_budget: null } } });
  expect(events.at(-2).progress.percent).toBe(100);
  expect(events.at(-1).payload.documents).toEqual(fixtures[0].documents);
  expect(providerCall).toHaveBeenCalledWith('one', 1, 'generation');
  expect(finish).toHaveBeenCalledOnce();
  expect(text).not.toContain('fake-private-byok');
});
it('captures no provider usage on a capture failure and streams the cause and retry delay', async () => {
  const { session } = setup();
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  vi.mocked(capture).mockRejectedValueOnce(new ApiError('SCRAPE_TIMEOUT', 'Capture timed out.', 504, true, 3));
  const response = await session.fetch(new Request('https://analysis.internal/run', { method: 'POST', headers: { accept: 'application/x-ndjson' }, body: JSON.stringify({ sources: sources(), id: 'two', bias: null }) }));
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({ type: 'error', retry_after: '3', payload: { detail: { code: 'SCRAPE_TIMEOUT' }, telemetry: { provider_calls: 0, usage_status: 'not_called', final: true, demo_budget: { tokens_charged_or_reserved: 0, micro_usd_charged_or_reserved: 0 } } } });
  expect(events.some(e => e.progress?.percent === 100)).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
it('separates Gemini token counting from generation when input is rejected', async () => {
  const { session, providerCall } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ totalTokens: 999999 })));
  const response = await session.run(sources(), 'count', null, false, { provider: 'gemini', key: 'fake-gemini-key' });
  expect(await response.json()).toMatchObject({ telemetry: { provider_calls: 1, auxiliary_calls: 1, generation_attempts: 0, usage_status: 'unavailable', demo_budget: null } });
  expect(providerCall).toHaveBeenCalledWith('count', 1, 'auxiliary');
});
it('reports retry dispatches separately and preserves the conservative ledger amount', async () => {
  const { session, providerCall } = setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockImplementation(async () => success()));
  const progress: AnalysisProgress[] = [];
  const response = await session.run(sources(), 'retry', null, false, undefined, value => progress.push(value));
  expect(await response.json()).toMatchObject({ telemetry: { provider_calls: 2, generation_attempts: 2, auxiliary_calls: 0, demo_budget: { conservative: true } } });
  expect(providerCall).toHaveBeenCalledTimes(2);
  expect(progress.filter(p => p.stage === 'analyzing').map(p => p.telemetry.generation_attempts)).toEqual([1, 2]);
});
it('persists idempotent demo dispatch counters across days and excludes BYOK', () => {
  const now = Date.UTC(2026, 8, 18, 23, 59, 59), c = config({});
  const state = newState(now);
  const base = { id: 'one', ip: 'hash', sources: 1, provider: 'gemini', version: '1', now };
  reserve(state, base, c);
  recordProviderCall(state, 'one', 1, 'auxiliary', c, now);
  recordProviderCall(state, 'one', 1, 'auxiliary', c, now);
  const restored = JSON.parse(JSON.stringify(state));
  recordProviderCall(restored, 'one', 2, 'generation', c, now + 2000);
  expect(restored.totalCalls).toEqual({ auxiliary: 1, generation: 1 });
  expect(restored.dailyCalls).toEqual({ auxiliary: 0, generation: 1 });
  settle(restored, 'one', { browserMs: 0, tokens: 0, microUsd: 0, provider: 'gemini', version: '1' }, c, now + 2000);
  reserve(restored, { ...base, now: now + 2000, id: 'own', funding: 'byok' }, c);
  recordProviderCall(restored, 'own', 1, 'generation', c, now + 2000);
  expect(restored.totalCalls).toEqual({ auxiliary: 1, generation: 1 });
  expect(() => recordProviderCall(restored, 'missing', 1, 'generation', c, now + 2000)).toThrow();
});
it('continues settlement if a stream consumer stops waiting', async () => {
  const { session, finish } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => { await gate; return success(); }));
  const response = await session.fetch(new Request('https://analysis.internal/run', { method: 'POST', headers: { accept: 'application/x-ndjson' }, body: JSON.stringify({ sources: sources(), id: 'cancel', bias: null }) }));
  await response.body!.cancel();
  release();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
});

it('retains provider-reported consumption when a response is incomplete', async () => {
  const { session } = setup();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'incomplete', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } })));
  const progress: AnalysisProgress[] = [];
  const response = await session.run(sources(), 'incomplete', null, false, undefined, value => progress.push(value));
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ detail: { code: 'AI_FAILED' }, telemetry: { generation_attempts: 1, final: true, usage_status: 'reported', usage: { input_tokens: 10, output_tokens: 20, status: 'exact' }, demo_budget: { conservative: true } } });
  expect(progress.some(p => p.percent === 100)).toBe(false);
});
