import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AnalysisErrorPanel from '../src/components/AnalysisErrorPanel'
import LoadingSkeleton from '../src/components/LoadingSkeleton'
import SessionUsage from '../src/components/SessionUsage'
import DesignLibrary from '../src/components/DesignLibrary'
import { makeIssue, retryDeadline } from '../src/analysisError'
import { analyzeWebsite } from '../src/api'
import { resultFixture } from './resultFixture'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('preserves backend error metadata and Retry-After', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ detail: { code: 'SCRAPE_TIMEOUT', message: 'The source timed out.', retryable: true } }, { status: 504, headers: { 'Retry-After': '30' } }))
  const now = Date.now()
  await expect(analyzeWebsite('https://example.com', new AbortController().signal)).rejects.toMatchObject({ issue: { code: 'SCRAPE_TIMEOUT', retryable: true, category: 'Website capture timed out', retryAt: expect.any(Number) } })
  expect(retryDeadline('30', now)).toBe(now + 30000)
  expect(retryDeadline(new Date(now + 60000).toUTCString(), now)).toBeGreaterThan(now)
  expect(retryDeadline('bad', now)).toBeNull()
})

it('does not treat cancellation during response parsing as an unreadable error', async () => {
  const controller = new AbortController()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, headers: new Headers(), json: async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError') } } as Response)
  await expect(analyzeWebsite('https://example.com', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('keeps retry disabled until the server deadline, then requires a click', () => {
  vi.useFakeTimers()
  const retry = vi.fn()
  render(<AnalysisErrorPanel issue={makeIssue('SCRAPE_TIMEOUT', 'Slow page', true, Date.now() + 3000)} disabled={false} onRetry={retry} />)
  expect(screen.getByRole('button', { name: 'Retry in 3s' })).toBeDisabled()
  act(() => vi.advanceTimersByTime(3000))
  expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledTimes(1)
})

it('does not offer retry for fatal capture limits', () => {
  render(<AnalysisErrorPanel issue={makeIssue('SCRAPE_RESOURCE_LIMIT', 'Too many bytes')} disabled={false} onRetry={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Website exceeds capture limits' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open saved designs' })).toBeInTheDocument()
})

it('shows elapsed time and a slow response without fabricating percentage', () => {
  vi.useFakeTimers()
  render(<LoadingSkeleton isMix startedAt={Date.now()} />)
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('value')
  act(() => vi.advanceTimersByTime(65000))
  expect(screen.getByLabelText('Elapsed time')).toHaveTextContent('1:05')
  expect(screen.getAllByRole('status').some(el => el.textContent?.includes('Still waiting'))).toBe(true)
  expect(screen.getByText(/Stopping waiting does not cancel remote work/)).toBeInTheDocument()
})

it('separates funding and unknown costs without reporting a complete subtotal', () => {
  const usage = resultFixture.metadata.usage!
  render(<SessionUsage entries={[
    { id: 1, funding: 'demo', provider: 'gemini', outcome: 'completed', usage },
    { id: 2, funding: 'demo', provider: 'gemini', outcome: 'cancelled' },
    { id: 3, funding: 'byok', provider: 'openai', outcome: 'failed' },
  ]} />)
  expect(screen.getByText('Design Scraper / gemini · 2 requests')).toBeInTheDocument()
  expect(screen.getByText('Your API key / openai · 1 requests')).toBeInTheDocument()
  expect(screen.getByText('1 with unknown or incomplete cost · partial subtotal')).toBeInTheDocument()
  expect(within(screen.getByRole('row', { name: /#3/ })).getAllByText('Unknown')).toHaveLength(3)
})

it('opens a saved design and changes formats with no API calls', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  render(<DesignLibrary />)
  fireEvent.click(screen.getByRole('button', { name: 'View Milligram design' }))
  expect(await screen.findByRole('heading', { name: 'Design findings' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('Original analysis usage'))
  expect(screen.getByText(/Historical usage from the saved analysis/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Export design', exact: true }))
  fireEvent.click(screen.getByRole('tab', { name: 'CSS Variables' }))
  expect(screen.getByLabelText('CSS Variables raw output')).toBeInTheDocument()
  expect(fetcher).not.toHaveBeenCalled()
})
