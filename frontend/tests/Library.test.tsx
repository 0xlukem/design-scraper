import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import * as downloads from '../src/download'
import DesignLibrary from '../src/components/DesignLibrary'
import catalog from '../src/examples/catalog.json'
import { formatLibraryDate, libraryExamples, librarySuggestions } from '../src/library'

afterEach(() => vi.restoreAllMocks())

const quota = { day: '2026-10-10', resets_at: '2026-10-11T00:00:00Z', analyses: { used: 3, limit: 20, remaining: 17 }, capture: { used_or_reserved_ms: 60000, limit_ms: 480000, remaining_ms: 420000 }, concurrency: { active: 0, limit: 1 }, per_ip: { hourly_limit: 3, daily_limit: 5 }, demo_budget_available: true }

it('builds every library card from the catalog with a saved design behind it', async () => {
  expect(libraryExamples.map(example => example.id)).toEqual(catalog.map(entry => entry.id))
  for (const example of libraryExamples) {
    expect(example.palette).toHaveLength(4)
    expect(example.sources.length).toBe(example.mode === 'mix' ? 2 : 1)
    const saved = await example.load()
    expect(saved.success).toBe(true)
    if (example.mode === 'mix' && 'mode' in saved.metadata) expect(example.bias).toBe(saved.metadata.bias)
    const values = Object.values(saved.design_system!.colors).flat().map(token => token.value)
    example.preview.colors.forEach(value => expect(values).toContain(value))
    const fonts = [...saved.design_system!.typography.families, ...saved.design_system!.typography.scale.flatMap(spec => spec.family ? [spec.family] : [])].map(token => String(token.value).split(',')[0].trim().replace(/["']/g, ''))
    example.preview.fonts.forEach(font => expect(fonts).toContain(font))
    expect(saved.documents.extended.length).toBeGreaterThan(100)
  }
  expect(formatLibraryDate('2026-09-10')).toBe('Sep 2026')
})

it('opens one focused design via a shareable route and returns to the same card', async () => {
  render(<DesignLibrary />)
  const cards = screen.getAllByRole('article')
  expect(cards).toHaveLength(catalog.length)
  const stripe = within(cards.find(card => within(card).queryByRole('heading', { name: 'Stripe' }))!)
  expect(stripe.getByText('Sep 2026')).toBeInTheDocument()
  expect(stripe.getByRole('button', { name: /Download/ })).toBeVisible()
  expect(stripe.getByText('sohne-var')).toBeVisible()
  fireEvent.click(stripe.getByRole('link', { name: 'View Stripe design' }))
  expect(window.location.hash).toBe('#/library/stripe')
  await screen.findByRole('button', { name: 'Export design', exact: true })
  expect(screen.getByRole('heading', { name: 'Stripe', level: 1 })).toBeVisible()
  expect(screen.queryByRole('link', { name: 'View GitHub design' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: /Back to library/ }))
  expect(screen.getByRole('link', { name: 'View GitHub design' })).toBeVisible()
  await waitFor(() => expect(screen.getByRole('link', { name: 'View Stripe design' })).toHaveFocus())
})

it('opens a deep-linked mix and reuses its actual URLs and weights without an analysis', async () => {
  window.history.replaceState(null, '', '/#/library/bootstrap-milligram')
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(quota))
  render(<App />)
  await screen.findByRole('button', { name: 'Export design', exact: true })
  fireEvent.click(screen.getByRole('button', { name: 'Use as reference' }))
  expect(await screen.findByLabelText('First website URL')).toHaveValue('https://getbootstrap.com/docs/5.3/examples/heroes/')
  expect(screen.getByLabelText('Mix balance')).toHaveValue('25')
  expect(window.location.hash).toBe('#/analyze')
  await waitFor(() => expect(screen.getByLabelText('First website URL')).toHaveFocus())
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

it('recovers an invalid design link with the catalog', () => {
  window.history.replaceState(null, '', '/#/library/missing')
  render(<App />)
  expect(screen.getByRole('alert')).toHaveTextContent('was not found')
  expect(screen.getByRole('link', { name: 'View Stripe design' })).toBeVisible()
})

it('offers saved references as suggestions that prefill the form without submitting', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(quota), { headers: { 'content-type': 'application/json' } }))
  render(<App />)
  const expected = librarySuggestions('single', 3)
  const group = screen.getByRole('group', { name: 'Try a reference' })
  expect(within(group).getAllByRole('button')).toHaveLength(expected.length)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(within(group).getByRole('button', { name: new URL(expected[0].sources[0]).hostname.replace(/^www\./, '') }))
  expect(screen.getByLabelText('Website URL')).toHaveValue(expected[0].sources[0])
  expect(screen.getByLabelText('Website URL')).toHaveFocus()
  await screen.findByText(/17 of 20 shared analyses left today/)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/quotas$/)
  expect(fetcher.mock.calls.every(([, init]) => !init || !init.method || init.method === 'GET')).toBe(true)

  fireEvent.click(screen.getByRole('tab', { name: 'Mix It' }))
  const mixGroup = screen.getByRole('group', { name: 'Try a reference' })
  const pair = librarySuggestions('mix', 2)[0]
  fireEvent.click(within(mixGroup).getByRole('button', { name: pair.name }))
  expect(screen.getByLabelText('First website URL')).toHaveValue(pair.sources[0])
  expect(screen.getByLabelText('Second website URL')).toHaveValue(pair.sources[1])
  expect(screen.getByLabelText('Mix balance')).toHaveValue(String(pair.bias))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('explains when the shared allowance is exhausted or unreachable, and never blocks typing', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...quota, analyses: { used: 20, limit: 20, remaining: 0 } }), { headers: { 'content-type': 'application/json' } }))
  render(<App />)
  fireEvent.focus(screen.getByLabelText('Website URL'))
  await screen.findByText(/No shared analyses left today/)
  fireEvent.focus(screen.getByLabelText('Website URL'))
  expect(fetcher).toHaveBeenCalledTimes(1)
  fetcher.mockRejectedValue(new TypeError('offline'))
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com/' } })
  expect(screen.getByRole('button', { name: /analyze design/i })).toBeEnabled()
})

it('downloads the original saved document from its card without running an analysis', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  const download = vi.spyOn(downloads, 'downloadFile').mockImplementation(() => {})
  render(<DesignLibrary />)
  fireEvent.click(screen.getByRole('button', { name: 'Download Stripe design.md' }))
  await screen.findByText('Download prepared.')
  const saved = await libraryExamples.find(example => example.id === 'stripe')!.load()
  expect(download).toHaveBeenCalledWith(saved.documents!.extended, 'stripe-design.md', 'text/markdown;charset=utf-8')
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'View GitHub design' })).toBeVisible()
})
