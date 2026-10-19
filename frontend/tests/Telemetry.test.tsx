import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { analyzeWebsite, getOwnerBudget } from '../src/api'
import { readAnalysisStream } from '../src/analysisStream'
import type { AnalysisProgress, AnalysisTelemetry } from '../src/types'
import LoadingSkeleton from '../src/components/LoadingSkeleton'
import SessionUsage from '../src/components/SessionUsage'
import SharedBudget from '../src/components/SharedBudget'
import App from '../src/App'

const telemetry: AnalysisTelemetry = { funding: 'demo', provider: 'gemini', model: 'fixture', provider_calls: 2, generation_attempts: 1, auxiliary_calls: 1, final: false, usage_status: 'pending', usage: null, demo_budget: null, browser_ms: null, browser_reserved_ms: 75000 }
const progress: AnalysisProgress = { stage: 'analyzing', source: null, completed_steps: 2, total_steps: 4, percent: 50, telemetry }
const encode = (events: unknown[]) => new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join(''))
const response = (bytes: Uint8Array, split = 1) => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close() } }), { headers: { 'content-type': 'application/x-ndjson' } })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('parses split UTF-8, emits only confirmed progress and waits for a terminal result', async () => {
  const onProgress = vi.fn()
  const r = response(encode([{ type: 'progress', progress }, { type: 'result', payload: { success: true, design_md: '# Diseño' } }]))
  expect(await readAnalysisStream(r, new AbortController().signal, onProgress)).toMatchObject({ payload: { design_md: '# Diseño' } })
  expect(onProgress).toHaveBeenCalledWith(progress)
})
it('rejects interrupted streams instead of treating progress as success', async () => {
  await expect(readAnalysisStream(response(encode([{ type: 'progress', progress }])), new AbortController().signal)).rejects.toThrow(/before the final/)
})
it('retains streamed error cause, retry delay and confirmed no-call telemetry', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(encode([{ type: 'error', retry_after: '5', payload: { detail: { code: 'SCRAPE_TIMEOUT', message: 'Capture timed out', retryable: true }, telemetry: { ...telemetry, final: true, usage_status: 'not_called', provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0 } } }])))
  await expect(analyzeWebsite('https://example.com', new AbortController().signal)).rejects.toMatchObject({ issue: { code: 'SCRAPE_TIMEOUT', retryAt: expect.any(Number), telemetry: { provider_calls: 0, final: true } } })
})
it('renders a measured step percentage without pretending to estimate remaining time', () => {
  render(<LoadingSkeleton isMix={false} progress={progress} />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50')
  expect(screen.getByRole('status')).toHaveTextContent('Generating the design system · 50%')
  expect(screen.getByText(/not a time estimate/)).toBeInTheDocument()
})
it('shows zero only for confirmed no-call failures, not disconnected work', () => {
  render(<SessionUsage entries={[
    { id: 1, funding: 'demo', provider: 'gemini', outcome: 'failed', telemetry: { ...telemetry, final: true, usage_status: 'not_called', provider_calls: 0, generation_attempts: 0, auxiliary_calls: 0 } },
    { id: 2, funding: 'byok', provider: 'openai', outcome: 'cancelled', telemetry },
  ]} />)
  expect(within(screen.getByRole('row', { name: /#1/ })).getByText('US$0.00000')).toBeInTheDocument()
  expect(within(screen.getByRole('row', { name: /#2/ })).getAllByText('Unknown')).toHaveLength(2)
  expect(screen.getByText('Last confirmed counters. Remote work may continue; final usage is unknown.')).toBeInTheDocument()
})
it('reads public quotas without an administrative credential or analysis request', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ day: '2026-09-18', resets_at: '2026-09-19T00:00:00Z', analyses: { used: 2, limit: 20, remaining: 18 }, capture: { used_or_reserved_ms: 120000, limit_ms: 480000, remaining_ms: 360000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true }))
  render(<SharedBudget revision={0} />)
  fireEvent.click(screen.getByRole('button', { name: 'Check shared allowance' }))
  expect(await screen.findByText('18 / 20')).toBeInTheDocument()
  expect(f.mock.calls[0][0]).toMatch(/\/api\/quotas$/)
  expect(new Headers(f.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
})
it('requires secure transport for owner diagnostics and keeps the admin credential in headers only', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ day: '2026-09-18', admitted: 0, dailyLimit: 20, ipHourlyLimit: 3, ipDailyLimit: 5, browserMsUsedOrReserved: 0, browserMsLimit: 480000, tokensUsedOrReserved: 0, dailyTokenLimit: 100000, dailyMicroUsdUsedOrReserved: 42, totalMicroUsdUsedOrReserved: 42, dailyMicroUsdLimit: 1000000, totalMicroUsdLimit: 30000000, active: 0, costStatus: 'estimated', demoCalls: { since: '2026-09-18', daily: { generation: 0, auxiliary: 0 }, total: { generation: 0, auxiliary: 0 } }, activeReservations: { browserMs: 0, tokens: 0, microUsd: 0 } }))
  await expect(getOwnerBudget('fake-admin-token', new AbortController().signal)).rejects.toThrow(/HTTPS/)
  expect(f).not.toHaveBeenCalled()
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://ui.example', href: 'https://ui.example/' } })
  await getOwnerBudget('fake-admin-token', new AbortController().signal)
  const [url, options] = f.mock.calls[0]
  expect(url).not.toContain('fake-admin-token')
  expect(options?.body).toBeUndefined()
  expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fake-admin-token')
  expect(options?.redirect).toBe('error')
  f.mockResolvedValueOnce(Response.json({ demoCalls: {}, activeReservations: {}, totalMicroUsdUsedOrReserved: 42 }))
  await expect(getOwnerBudget('fake-admin-token', new AbortController().signal)).rejects.toThrow('Budget telemetry is unavailable')
})
it('retains last counters on cancellation without claiming final consumption', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(c) { controller = c } }), { headers: { 'content-type': 'application/x-ndjson' } }))
  render(<App />)
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /Analyze design/ }))
  await act(async () => controller.enqueue(encode([{ type: 'progress', progress }])))
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50'))
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
  await act(async () => { window.location.hash = '/activity'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(await screen.findByText('Last confirmed counters. Remote work may continue; final usage is unknown.')).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /#1/ })).toHaveTextContent('Unknown')
})
