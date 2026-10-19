import { describe, expect, it, vi } from 'vitest';
import { parseAnalysisResponse, readAnalysisResponse } from '../scripts/read-analysis-response.mjs';

const payload = { success: true, design_md: 'Español 🎨 — café' };
const progress = { type: 'progress', progress: { stage: 'capture', source: 'web_1', completed_steps: 1, total_steps: 4 } };
const terminal = { type: 'result', payload };
const ndjson = 'application/x-ndjson; charset=utf-8';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const playwright = (body: Buffer, status = 200, headers: Record<string, string> = { 'content-type': ndjson }) => ({ status: () => status, headers: () => headers, body: vi.fn(async () => body) });

describe('analysis verification response reader', () => {
  it('reads Playwright NDJSON and the old JSON replay body once without another request', async () => {
    for (const response of [playwright(encode(terminal)), playwright(encode(payload), 200, { 'content-type': 'application/json' })]) {
      await expect(readAnalysisResponse(response)).resolves.toEqual({ type: 'result', payload, status: 200, retryAfter: null });
      expect(response.body).toHaveBeenCalledTimes(1);
    }
  });

  it('preserves fragmented UTF-8, CRLF and a terminal record without a final newline', async () => {
    const wire = Buffer.from(`${JSON.stringify(progress)}\r\n\r\n${JSON.stringify(terminal)}`);
    // Every possible split includes boundaries inside both accented text and emoji.
    for (let split = 0; split <= wire.length; split++) {
      await expect(parseAnalysisResponse([wire.subarray(0, split), wire.subarray(split)], { status: 200, contentType: ndjson })).resolves.toMatchObject({ type: 'result', payload });
    }
  });

  it('reads the streaming Fetch adapter without assuming it has a Playwright body method', async () => {
    const bytes = encode(terminal);
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    await expect(readAnalysisResponse(new Response(stream, { headers: { 'content-type': ndjson } }))).resolves.toMatchObject({ type: 'result', payload });
    expect(stream.locked).toBe(false);
  });

  it('distinguishes HTTP errors and HTTP200 terminal errors while preserving Retry-After', async () => {
    const error = { detail: { code: 'PROVIDER_QUOTA_EXHAUSTED' } };
    await expect(readAnalysisResponse(playwright(encode(error), 429, { 'content-type': 'application/json', 'retry-after': '30' }))).resolves.toEqual({ type: 'error', payload: error, status: 429, retryAfter: '30' });
    await expect(readAnalysisResponse(playwright(encode({ type: 'error', payload: error, retry_after: '12' })))).resolves.toEqual({ type: 'error', payload: error, status: 200, retryAfter: '12' });
  });

  it.each([
    [JSON.stringify(progress), /before the final/],
    [`${JSON.stringify(progress)}\n{"type":"result","payload":`, /Invalid JSON/],
    ['', /before the final/],
  ])('rejects truncated or unterminated streams: %s', async (body, expected) => {
    await expect(readAnalysisResponse(playwright(Buffer.from(body)))).rejects.toThrow(expected);
  });

  it.each([
    [terminal, terminal],
    [terminal, progress],
    [{ type: 'error', payload: {} }, terminal],
  ])('rejects duplicate or out-of-order terminal events', async (...events) => {
    await expect(readAnalysisResponse(playwright(Buffer.from(events.map(event => JSON.stringify(event)).join('\n'))))).rejects.toThrow(/after its terminal/);
  });

  it.each([
    { type: 'unexpected', payload },
    { type: 'result' },
    { type: 'error', payload: {}, retry_after: 12 },
    { type: 'progress', progress: { ...progress.progress, completed_steps: 7 } },
  ])('rejects malformed events', async event => {
    await expect(readAnalysisResponse(playwright(encode(event)))).rejects.toThrow(/Invalid analysis progress|invalid terminal/);
  });

  it('bounds declared and actual byte counts before parsing', async () => {
    const declared = playwright(encode(terminal), 200, { 'content-type': ndjson, 'content-length': '999' });
    await expect(readAnalysisResponse(declared, { maxBytes: 32 })).rejects.toThrow(/size limit/);
    expect(declared.body).not.toHaveBeenCalled();
    await expect(readAnalysisResponse(playwright(encode(terminal)), { maxBytes: 32 })).rejects.toThrow(/size limit/);
  });

  it('fails closed on invalid UTF-8 and suppresses raw body contents in parsing errors', async () => {
    await expect(readAnalysisResponse(playwright(Buffer.from([0xff])))).rejects.toThrow('Invalid UTF-8 in the analysis response.');
    await expect(readAnalysisResponse(playwright(Buffer.from('sensitive-provider-data'), 502, { 'content-type': 'text/html' }))).rejects.toThrow('Invalid JSON in the analysis response.');
  });

  it('times out a stalled stream, cancels its reader and never retries', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    await expect(readAnalysisResponse(new Response(stream, { headers: { 'content-type': ndjson } }), { timeoutMs: 5 })).rejects.toThrow(/Timed out/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
});
