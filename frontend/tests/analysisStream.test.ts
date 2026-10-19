import { expect, it, vi } from 'vitest'
import { readAnalysisStream } from '../src/analysisStream'
import type { AnalysisProgress, AnalysisTelemetry } from '../src/types'

const telemetry: AnalysisTelemetry = { funding: 'demo', provider: 'gemini', model: 'fixture', provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0, final: false, usage_status: 'pending', usage: null, demo_budget: null, browser_ms: null, browser_reserved_ms: 75000 }
const progress: AnalysisProgress = { stage: 'capture', source: 'web_1', completed_steps: 1, total_steps: 4, percent: 25, telemetry }
const terminal = { type: 'result', payload: { success: true, design_md: '# Diseño' } }

function stream(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } }))
}

it('reads a split UTF-8 terminal event even when the last line has no newline', async () => {
  const onProgress = vi.fn()
  const response = stream(`${JSON.stringify({ type: 'progress', progress })}\r\n\n${JSON.stringify(terminal)}`)
  expect(await readAnalysisStream(response, new AbortController().signal, onProgress)).toEqual(terminal)
  expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress)
  expect(response.body?.locked).toBe(false)
})

it('reserves 100 percent for a validated terminal payload', async () => {
  const onProgress = vi.fn()
  await readAnalysisStream(stream([
    { type: 'progress', progress: { ...progress, stage: 'exporting', completed_steps: 4, percent: 100 } },
    { type: 'progress', progress: { ...progress, stage: 'complete', completed_steps: 4, percent: 100 } },
    terminal,
  ].map(event => JSON.stringify(event)).join('\n')), new AbortController().signal, onProgress)
  expect(onProgress).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ percent: 99 }))
})

it.each([
  { ...progress, stage: 'invented' },
  { ...progress, source: {} },
  { ...progress, telemetry: { demo_budget: {} } },
  { ...progress, telemetry: { ...telemetry, final: true, usage_status: 'not_called', provider_calls: 1, generation_attempts: 1 } },
  { ...progress, telemetry: { ...telemetry, usage_status: { toString: null } } },
  { ...progress, telemetry: { ...telemetry, final: true, usage_status: 'reported' } },
  { ...progress, telemetry: { ...telemetry, provider_calls: 2, generation_attempts: 1, auxiliary_calls: 0 } },
  { ...progress, completed_steps: 5 },
])('rejects invalid progress before it can reach the UI', async invalid => {
  const onProgress = vi.fn()
  await expect(readAnalysisStream(stream(JSON.stringify({ type: 'progress', progress: invalid })), new AbortController().signal, onProgress)).rejects.toThrow('Invalid analysis progress')
  expect(onProgress).not.toHaveBeenCalled()
})

it('cancels a stalled reader and releases its lock when the user stops waiting', async () => {
  const cancelled = vi.fn()
  const response = new Response(new ReadableStream({ cancel: cancelled }))
  const controller = new AbortController()
  const reading = readAnalysisStream(response, controller.signal)
  controller.abort()
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
  expect(cancelled).toHaveBeenCalledTimes(1)
  expect(response.body?.locked).toBe(false)
})

it('rejects a terminal event without its payload', async () => {
  await expect(readAnalysisStream(stream('{"type":"result"}\n'), new AbortController().signal)).rejects.toThrow('Invalid terminal analysis event')
})
