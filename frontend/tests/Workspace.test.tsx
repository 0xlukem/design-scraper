import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '../src/api'
import App from '../src/App'
import { resultFixture } from './resultFixture'
import { AnalysisError, makeIssue } from '../src/analysisError'

const providers = ['gemini', 'anthropic', 'openai', 'xai'].map(provider => ({ provider, model: `${provider}-test`, inputPrice: 1, outputPrice: 2 })) as Awaited<ReturnType<typeof api.getProviders>>
afterEach(() => vi.restoreAllMocks())
async function navigate(section: string) {
  await act(async () => { window.location.hash = `/${section}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}
async function ownKey() {
  vi.spyOn(api, 'byokAvailable').mockReturnValue(true)
  vi.spyOn(api, 'getProviders').mockResolvedValue(providers)
  fireEvent.click(screen.getByRole('button', { name: /Use my API key|Manage key/, exact: true }))
  await screen.findByText('Model: gemini-test')
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'fake-key-123456' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
}
it('keeps an in-flight analysis and URL through section changes, and records it once', async () => {
  let finish!: (value: typeof resultFixture) => void
  const analyze = vi.spyOn(api, 'analyzeWebsite').mockReturnValue(new Promise(resolve => { finish = resolve }))
  render(<App />)
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  await navigate('library')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Design library' })).toBeVisible()
  await act(async () => finish(resultFixture))
  await navigate('activity')
  expect(screen.getByText('for analysis #1').closest('li')!).toHaveTextContent('https://example.com')
  expect(screen.queryByText('for analysis #2')).not.toBeInTheDocument()
  await navigate('analyze')
  expect(screen.getByLabelText('Website URL')).toHaveValue('https://example.com')
  expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(analyze).toHaveBeenCalledTimes(1)
})
it('never verifies a key by format; preserves it across navigation and resets verification on edit', async () => {
  const analyze = vi.spyOn(api, 'analyzeWebsite').mockResolvedValue(resultFixture)
  render(<App />)
  await ownKey()
  expect(screen.getByText(/Ready for next analysis/)).toBeVisible()
  expect(analyze).not.toHaveBeenCalled()
  await navigate('activity')
  fireEvent.click(screen.getByRole('button', { name: /Use my API key|Manage key/, exact: true }))
  expect(screen.getByLabelText('Provider API key')).toHaveValue('fake-key-123456')
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
  await navigate('analyze')
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  expect(await screen.findByText(/Verified/)).toBeVisible()
  analyze.mockRejectedValueOnce(new AnalysisError(makeIssue('SCRAPE_TIMEOUT', 'Page timed out')))
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  await screen.findByText('Page timed out')
  expect(screen.getByText(/Verified/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Use my API key|Manage key/, exact: true }))
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'fake-new-key-123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
  expect(screen.getByText(/Ready for next analysis/)).toBeVisible()
  analyze.mockRejectedValueOnce(new AnalysisError(makeIssue('PROVIDER_AUTH_ERROR', 'Key rejected')))
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  expect(await screen.findByText(/Needs attention/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Use my API key|Manage key/, exact: true }))
  await navigate('library')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await navigate('analyze')
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze design' })).toBeDisabled())
  expect(screen.getByText(/Key cleared/)).toBeVisible()
})

it('keeps separate results in history and restores original inputs without submitting', async () => {
  const analyze = vi.spyOn(api, 'analyzeWebsite').mockResolvedValue(resultFixture)
  render(<App />)
  for (const url of ['https://first.example', 'https://second.example']) {
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: url } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze design' })).toBeEnabled())
  }
  await navigate('activity')
  expect(screen.getAllByRole('link', { name: /View result for analysis/ })).toHaveLength(2)
  await navigate('activity/1')
  expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Use these URLs' }))
  await waitFor(() => expect(screen.getByLabelText('Website URL')).toHaveValue('https://first.example'))
  expect(analyze).toHaveBeenCalledTimes(2)
  await navigate('activity/999')
  expect(screen.getByText(/no longer in this session/i)).toBeVisible()
})

it('recovers both mix input slots from a 0/100 run', async () => {
  const single = vi.spyOn(api, 'analyzeWebsite').mockResolvedValue(resultFixture)
  render(<App />)
  fireEvent.click(screen.getByRole('tab', { name: 'Mix It' }))
  fireEvent.change(screen.getByLabelText('First website URL'), { target: { value: 'https://excluded.example/' } })
  fireEvent.change(screen.getByLabelText('Second website URL'), { target: { value: 'https://active.example/' } })
  fireEvent.change(screen.getByLabelText('Mix balance'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze selected source' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze selected source' })).toBeEnabled())
  await navigate('activity/1')
  fireEvent.click(screen.getByRole('button', { name: 'Use these URLs' }))
  await waitFor(() => expect(screen.getByLabelText('Second website URL')).toHaveValue('https://active.example/'))
  expect(screen.getByLabelText('First website URL')).toHaveValue('https://excluded.example/')
  expect(single).toHaveBeenCalledTimes(1)
})

it('offers key setup when an exhausted included allowance has no saved BYOK key', async () => {
  vi.spyOn(api, 'getSharedQuota').mockResolvedValue({
    day: '2026-11-03', resets_at: '2026-11-04T00:00:00Z', analyses: { used: 2, limit: 20, remaining: 18 },
    capture: { used_or_reserved_ms: 75000, limit_ms: 480000, remaining_ms: 405000 },
    concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: false,
  })
  render(<App />)
  await ownKey()
  await navigate('activity')
  await screen.findByText('Available', { exact: true })
  fireEvent.click(screen.getByRole('button', { name: 'Manage key' }))
  fireEvent.click(screen.getByText('Usage & key removal'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear key' }))
  expect(await screen.findByText('Included AI unavailable')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Set up my API key' })).toBeVisible()
  await navigate('analyze')
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
  expect(screen.getByRole('button', { name: 'Analyze design' })).toBeDisabled()
})
