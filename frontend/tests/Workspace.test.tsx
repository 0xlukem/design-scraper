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
  fireEvent.click(screen.getByRole('button', { name: 'Use your own key', exact: true }))
  fireEvent.click(screen.getByRole('radio', { name: 'Your own key', exact: true }))
  await screen.findByText('Model: gemini-test')
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'fake-key-123456' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
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
  expect(screen.getByRole('row', { name: /#1/ })).toHaveTextContent('https://example.com')
  expect(screen.queryByRole('row', { name: /#2/ })).not.toBeInTheDocument()
  await navigate('analyze')
  expect(screen.getByLabelText('Website URL')).toHaveValue('https://example.com')
  expect(screen.getByRole('heading', { name: 'Design findings' })).toBeVisible()
  expect(analyze).toHaveBeenCalledTimes(1)
})
it('never verifies a key by format; preserves it across navigation and resets verification on edit', async () => {
  const analyze = vi.spyOn(api, 'analyzeWebsite').mockResolvedValue(resultFixture)
  render(<App />)
  await ownKey()
  expect(screen.getByText('Not verified')).toBeVisible()
  expect(analyze).not.toHaveBeenCalled()
  await navigate('activity')
  fireEvent.click(screen.getByRole('button', { name: 'Use your own key', exact: true }))
  expect(screen.getByLabelText('Provider API key')).toHaveValue('fake-key-123456')
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await navigate('analyze')
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  expect(await screen.findByText('Verified')).toBeVisible()
  analyze.mockRejectedValueOnce(new AnalysisError(makeIssue('SCRAPE_TIMEOUT', 'Page timed out')))
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  await screen.findByText('Page timed out')
  expect(screen.getByText('Verified')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Use your own key', exact: true }))
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'fake-new-key-123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.getByText('Not verified')).toBeVisible()
  analyze.mockRejectedValueOnce(new AnalysisError(makeIssue('PROVIDER_AUTH_ERROR', 'Key rejected')))
  fireEvent.click(screen.getByRole('button', { name: 'Analyze design' }))
  expect(await screen.findByText('Needs attention')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Use your own key', exact: true }))
  await navigate('library')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await navigate('analyze')
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze design' })).toBeDisabled())
  expect(screen.getByText('Not verified')).toBeVisible()
})
