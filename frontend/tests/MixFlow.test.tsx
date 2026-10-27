import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import * as api from '../src/api'
import { resultFixture } from './resultFixture'
afterEach(() => vi.restoreAllMocks())
it.each([-50, 50])('analyzes only the active source at bias %s without requiring an excluded URL', async bias => {
  const analyze = vi.spyOn(api, 'analyzeWebsite').mockResolvedValue(resultFixture)
  const mix = vi.spyOn(api, 'mixWebsites')
  render(<App />)
  fireEvent.click(screen.getByRole('tab', { name: 'Mix It' }))
  fireEvent.change(screen.getByLabelText('Mix balance'), { target: { value: String(bias) } })
  const active = screen.getByLabelText(bias === -50 ? 'First website URL' : 'Second website URL')
  const excluded = screen.getByLabelText(bias === -50 ? 'Second website URL' : 'First website URL')
  expect(excluded).toBeDisabled()
  expect(excluded).not.toBeRequired()
  expect(active).toBeRequired()
  fireEvent.change(active, { target: { value: 'https://example.com/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze selected source' }))
  await waitFor(() => expect(analyze).toHaveBeenCalledOnce())
  expect(analyze.mock.calls[0][0]).toBe('https://example.com/')
  expect(mix).not.toHaveBeenCalled()
  await screen.findByRole('button', { name: 'Export design', exact: true })
})
it('preserves excluded input when restoring a blend and blocks duplicate normalized URLs locally', () => {
  const mix = vi.spyOn(api, 'mixWebsites')
  render(<App />)
  fireEvent.click(screen.getByRole('tab', { name: 'Mix It' }))
  fireEvent.change(screen.getByLabelText('First website URL'), { target: { value: 'https://example.com' } })
  fireEvent.change(screen.getByLabelText('Second website URL'), { target: { value: 'https://example.com/' } })
  expect(screen.getByRole('button', { name: 'Mix designs' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('two different URLs')
  fireEvent.change(screen.getByLabelText('Mix balance'), { target: { value: '-50' } })
  expect(screen.getByRole('button', { name: 'Analyze selected source' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Mix balance'), { target: { value: '0' } })
  expect(screen.getByLabelText('Second website URL')).toHaveValue('https://example.com/')
  expect(screen.getByRole('button', { name: 'Mix designs' })).toBeDisabled()
  expect(mix).not.toHaveBeenCalled()
})
