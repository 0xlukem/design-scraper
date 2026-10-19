// Reads an already-issued Playwright or Fetch response; never sends or retries a
// request. Keep JSON replay fixtures compatible with the live NDJSON transport.
const MAX_BYTES = 16 * 1024 * 1024;
const STAGES = new Set(['admitted', 'capture', 'counting_tokens', 'analyzing', 'exporting', 'complete', 'failed']);

function json(text) {
  try { return JSON.parse(text); }
  // JSON.parse diagnostics can include response content, including provider data.
  catch { throw new Error('Invalid JSON in the analysis response.'); }
}

function progress(value) {
  return value && typeof value === 'object' && STAGES.has(value.stage) &&
    (value.source === null || typeof value.source === 'string') &&
    Number.isInteger(value.completed_steps) && Number.isInteger(value.total_steps) &&
    value.total_steps >= 4 && value.total_steps <= 5 &&
    value.completed_steps >= 0 && value.completed_steps <= value.total_steps;
}

/** Parse byte chunks without corrupting split UTF-8 or accepting partial results. */
export async function parseAnalysisResponse(chunks, { status, contentType = '', retryAfter = null, maxBytes = MAX_BYTES }) {
  const streaming = status >= 200 && status < 300 && contentType.toLowerCase().includes('application/x-ndjson');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, pending = '', terminal;
  const line = text => {
    if (!text.trim()) return;
    if (terminal) throw new Error('The analysis stream has data after its terminal event.');
    const event = json(text);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid analysis event.');
    if (event.type === 'progress') {
      if (!progress(event.progress)) throw new Error('Invalid analysis progress.');
    } else if ((event.type === 'result' || event.type === 'error') && 'payload' in event &&
      (event.retry_after == null || typeof event.retry_after === 'string')) {
      terminal = { type: event.type, payload: event.payload, retryAfter: event.retry_after || null, status };
    } else throw new Error('Unknown or invalid terminal analysis event.');
  };
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid analysis response bytes.');
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('The analysis response exceeded its size limit.');
    try { pending += decoder.decode(chunk, { stream: true }); }
    catch { throw new Error('Invalid UTF-8 in the analysis response.'); }
    if (streaming) {
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    }
  }
  try { pending += decoder.decode(); }
  catch { throw new Error('Invalid UTF-8 in the analysis response.'); }
  if (!streaming) return { type: status >= 200 && status < 300 ? 'result' : 'error', payload: json(pending), retryAfter, status };
  line(pending); // A final NDJSON record does not require a trailing newline.
  if (!terminal) throw new Error('The connection ended before the final analysis result.');
  return terminal;
}

/**
 * Playwright buffers response bodies; Fetch exposes a reader. Both paths have
 * an explicit deadline and size check, and neither calls response.json().
 */
export async function readAnalysisResponse(response, { maxBytes = MAX_BYTES, timeoutMs = 195000 } = {}) {
  const status = typeof response.status === 'function' ? response.status() : response.status;
  const headers = typeof response.headers === 'function' ? response.headers() : response.headers;
  const header = name => typeof headers.get === 'function' ? headers.get(name) : headers[name] || null;
  const length = header('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error('The analysis response exceeded its size limit.');
  let reader, timer;
  async function* chunks() {
    if (typeof response.body === 'function') {
      let body;
      try { body = await response.body(); }
      catch { throw new Error('The analysis response body could not be read.'); }
      yield body;
    } else {
      if (!response.body) throw new Error('The analysis response body is unavailable.');
      reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        yield value;
      }
    }
  }
  try {
    return await Promise.race([
      parseAnalysisResponse(chunks(), { status, contentType: header('content-type') || '', retryAfter: header('retry-after'), maxBytes }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for the final analysis response.')), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
