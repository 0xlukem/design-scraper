import type { AnalysisProgress } from './telemetry-contract';
export type { AnalysisProgress, AnalysisTelemetry } from './telemetry-contract';

// A bounded number of progress events and one final payload; no polling endpoint,
// stored result, public session identifier or credential-bearing URL is needed.
export function streamAnalysis(
  run: (emit: (progress: AnalysisProgress) => void) => Promise<Response>,
): Response {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      };
      void (async () => {
        try {
          const response = await run(progress => send({ type: 'progress', progress }));
          const payload: unknown = await response.json();
          send({ type: response.ok ? 'result' : 'error', payload, retry_after: response.headers.get('retry-after') });
        } catch {
          send({ type: 'error', payload: { detail: { code: 'ANALYSIS_UNAVAILABLE', message: 'The analysis runtime is temporarily unavailable.', retryable: true } } });
        } finally {
          if (!cancelled) controller.close();
        }
      })();
    },
    cancel() { cancelled = true; },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store, no-transform' } });
}
