import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '../src/api'
import ProviderControls from '../src/components/ProviderControls'
import ProviderRates from '../src/components/ProviderRates'
const catalog = [{ provider: 'gemini' as const, model: 'gemini-test', inputPrice: 1, outputPrice: 2 }, { provider: 'openai' as const, model: 'openai-test', inputPrice: null, outputPrice: null }]
afterEach(() => vi.restoreAllMocks())
it('only activates a valid accepted key on apply; cancelling edits preserves the active key', async () => {
  vi.spyOn(api, 'byokAvailable').mockReturnValue(true)
  vi.spyOn(api, 'getProviders').mockResolvedValue(catalog)
  const changed = vi.fn()
  render(<ProviderControls busy={false} onChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use my API key' }))
  await screen.findByText('Model: gemini-test')
  fireEvent.change(screen.getByLabelText('Provider API key'), { target: { value: 'fake-key-123456' } })
  expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
  expect(changed).toHaveBeenLastCalledWith({ provider: 'gemini', key: 'fake-key-123456' })
  fireEvent.click(screen.getByRole('button', { name: 'Manage key' }))
  fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'openai' } })
  expect(screen.getByLabelText('Provider API key')).toHaveValue('')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(changed).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Manage key' }))
  expect(screen.getByLabelText('AI provider')).toHaveValue('gemini')
  expect(screen.getByLabelText('Provider API key')).toHaveValue('fake-key-123456')
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  expect(screen.getByLabelText('Provider API key')).toHaveValue('')
  expect(changed).toHaveBeenLastCalledWith(null)
  expect(window.localStorage.length + window.sessionStorage.length).toBe(0)
})
it('loads the independent catalog only when opened, retaining unknown and stale rates on failure', async () => {
  const providers = vi.spyOn(api, 'getProviders').mockResolvedValue(catalog)
  const view = render(<ProviderRates active={false} />)
  expect(providers).not.toHaveBeenCalled()
  view.rerender(<ProviderRates active />)
  await screen.findByText('openai-test')
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  providers.mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh rates' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('last successfully loaded'))
  expect(screen.getByText('gemini-test')).toBeInTheDocument()
  expect(screen.queryByLabelText('Provider API key')).not.toBeInTheDocument()
})

it('offers recovery without an empty rate table when the catalog cannot load', async () => {
  vi.spyOn(api, 'getProviders').mockRejectedValue(new Error('offline'))
  render(<ProviderRates active />)
  await screen.findByRole('button', { name: 'Reload model rates' })
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
