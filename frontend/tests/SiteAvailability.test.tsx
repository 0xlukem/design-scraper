import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SharedBudget from '../src/components/SharedBudget'
import { getSharedQuota } from '../src/api'

const quota = { day: '2026-10-26', resets_at: '2026-10-27T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

it('loads only in activity, refreshes on return, and never sends credentials', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(quota))
  const view = render(<SharedBudget revision={0} active={false} />)
  expect(fetcher).not.toHaveBeenCalled()
  view.rerender(<SharedBudget revision={0} active />)
  await screen.findByText('17')
  expect(screen.getByText('7 min')).toBeInTheDocument()
  expect(screen.getByText('0 / 1')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByText(/administrative|Owner budget/i)).not.toBeInTheDocument()
  view.rerender(<SharedBudget revision={0} active={false} />)
  view.rerender(<SharedBudget revision={0} active />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  for (const [url, options] of fetcher.mock.calls) {
    expect(url).toBe('/api/quotas')
    expect(options?.method).toBeUndefined()
    expect(options?.credentials).toBe('omit')
    expect(options?.headers).toBeUndefined()
  }
})

it('shows unknown values on a network error, then recovers with real counts', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
  render(<SharedBudget revision={0} active />)
  await screen.findByText('Could not check')
  expect(screen.getByRole('status')).toHaveTextContent('does not mean the quota is used up')
  expect(screen.getAllByText('—')).toHaveLength(4)
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  fetcher.mockResolvedValueOnce(Response.json(quota))
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('17')
  expect(screen.getByRole('button', { name: 'Check availability' })).toBeEnabled()
})

it('labels the last successful values as stale if refresh fails', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(quota))
  render(<SharedBudget revision={0} active />)
  await screen.findByText('17')
  fetcher.mockResolvedValueOnce(new Response('', { status: 503 }))
  fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
  await screen.findByText('Could not check')
  expect(screen.getByRole('status')).toHaveTextContent('HTTP 503')
  expect(screen.getByRole('status')).toHaveTextContent('last successful update')
  expect(within(screen.getByLabelText('Last known site capacity')).getByText('17')).toBeInTheDocument()
})

it.each([
  { ...quota, analyses: { used: 20, limit: 20, remaining: 0 } },
  { ...quota, capture: { used_or_reserved_ms: 480000, limit_ms: 480000, remaining_ms: 0 } },
])('does not imply that a personal key bypasses exhausted shared capacity', async snapshot => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot))
  render(<SharedBudget revision={0} active />)
  await screen.findByText('Daily limit reached')
  expect(screen.getByRole('status')).toHaveTextContent('Your own API key also uses')
  expect(screen.queryByText('Included AI unavailable')).not.toBeInTheDocument()
})

it('distinguishes shared AI capacity from analysis and capture counts', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...quota, demo_budget_available: false }))
  render(<SharedBudget revision={0} active />)
  await screen.findByText('Included AI unavailable')
  expect(screen.getByText('17')).toBeInTheDocument()
  expect(screen.getByText('At capacity')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('while analysis and capture capacity remain')
})

it('aborts an unfinished request when leaving activity', async () => {
  let pendingSignal: AbortSignal | null | undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
    pendingSignal = options?.signal
    return new Promise((_resolve, reject) => pendingSignal?.addEventListener('abort', () => reject(pendingSignal?.reason)))
  })
  const view = render(<SharedBudget revision={0} active />)
  expect(pendingSignal?.aborted).toBe(false)
  await act(async () => { view.rerender(<SharedBudget revision={0} active={false} />) })
  expect(pendingSignal?.aborted).toBe(true)
})

it('times out a stalled request with a recoverable explanation', async () => {
  vi.useFakeTimers()
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
  }))
  const request = expect(getSharedQuota(new AbortController().signal)).rejects.toThrow('took too long')
  await vi.advanceTimersByTimeAsync(10000)
  await request
})

it('does not fetch when cancelled before starting', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  const controller = new AbortController()
  controller.abort()
  await expect(getSharedQuota(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([
  ['http://127.0.0.1:4173', '/api/quotas'],
  ['https://design-scraper.pages.dev', 'https://api.example/api/quotas'],
])('keeps the public counter on the correct transport for %s', async (origin, expected) => {
  vi.stubEnv('VITE_API_URL', 'https://api.example')
  vi.stubGlobal('window', { location: new URL(origin) })
  vi.resetModules()
  const { getSharedQuota: readQuota } = await import('../src/api')
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(quota))
  await readQuota(new AbortController().signal)
  expect(fetcher.mock.calls[0][0]).toBe(expected)
})
