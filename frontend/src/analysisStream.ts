import type { AnalysisProgress } from './types'
import { isAnalysisTelemetry } from './responseValidation'

type TerminalEvent = { type: 'result' | 'error'; payload: unknown; retry_after?: string | null }

// Reads arbitrarily split UTF-8 lines. A disconnected stream never becomes a
// success or an automatic retry. Bound the accumulated final result in memory.
export async function readAnalysisStream(response: Response, signal: AbortSignal, onProgress?: (progress: AnalysisProgress) => void) {
  if (!response.body) throw new Error('The analysis stream is unavailable.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = '', bytes = 0
  const readLine = (line: string): TerminalEvent | undefined => {
    if (!line.trim()) return
    const event = JSON.parse(line)
    if (event?.type === 'progress') {
      const p = event.progress as AnalysisProgress
      if (!p || !['admitted', 'capture', 'counting_tokens', 'analyzing', 'exporting', 'complete', 'failed'].includes(p.stage) ||
        !(p.source === null || typeof p.source === 'string') ||
        !Number.isInteger(p.completed_steps) || !Number.isInteger(p.total_steps) ||
        p.total_steps < 4 || p.total_steps > 5 || p.completed_steps < 0 || p.completed_steps > p.total_steps ||
        !isAnalysisTelemetry(p.telemetry)) throw new Error('Invalid analysis progress.')
      // Receiving completed server steps is not the same as receiving and
      // validating the final payload. Never announce 100% before that result.
      if (p.stage !== 'complete') onProgress?.({ ...p, percent: Math.min(99, Math.floor(p.completed_steps * 100 / p.total_steps)) })
    } else if (event?.type === 'result' || event?.type === 'error') {
      if (!('payload' in event) || (event.retry_after != null && typeof event.retry_after !== 'string')) throw new Error('Invalid terminal analysis event.')
      return event as TerminalEvent
    } else throw new Error('Unknown analysis event.')
  }
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      bytes += value?.byteLength || 0
      if (bytes > 16 * 1024 * 1024) throw new Error('The analysis stream exceeded its size limit.')
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim()
        pending = pending.slice(end + 1)
        if (!line) continue
        const terminal = readLine(line)
        if (terminal) return terminal
      }
      if (done) {
        // A final JSON record remains valid when a proxy closes the response
        // immediately after it, without a trailing newline.
        const terminal = readLine(pending)
        if (terminal) return terminal
        throw new Error('The connection ended before the final analysis result.')
      }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
