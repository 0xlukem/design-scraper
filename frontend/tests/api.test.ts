import { afterEach, expect, it, vi } from 'vitest'
import { analyzeWebsite, getProviders, getSharedQuota, mixWebsites } from '../src/api'
import savedDesign from '../src/examples/milligram.json'
import stripeDesign from '../src/examples/stripe.json'
import blendDesign from '../src/examples/bootstrap-milligram.json'
import simpleDesign from '../src/examples/example-domain.json'

afterEach(() => vi.restoreAllMocks())

it.each(['single', 'mix'])('submits %s directly without a session or access credential', async mode => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, design_md: '# Test', metadata: { url: 'https://one.example', title: 'One' } }))
  const signal = new AbortController().signal
  if (mode === 'single') await analyzeWebsite('https://one.example', signal)
  else await mixWebsites('https://one.example', 'https://two.example', 25, signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, options] = fetcher.mock.calls[0]
  expect(url).toMatch(mode === 'single' ? /\/api\/analyze$/ : /\/api\/mix$/)
  expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  expect(options?.redirect).toBe('error')
  expect(options?.signal).toBe(signal)
  expect(JSON.parse(String(options?.body))).toEqual(mode === 'single'
    ? { url: 'https://one.example' }
    : { url_1: 'https://one.example', url_2: 'https://two.example', bias: 25 })
})

it.each([
  ['Milligram', savedDesign], ['Stripe', stripeDesign], ['Bootstrap × Milligram', blendDesign], ['Example Domain', simpleDesign],
])('validates the saved %s response without changing its five outputs', async (_name, payload) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))
  const result = await analyzeWebsite('https://milligram.io', new AbortController().signal)
  expect(result).toEqual(payload)
})

it.each([
  { success: true, design_md: '# Incomplete' },
  { ...savedDesign, metadata: { mode: 'mix', sources: null } },
  { ...savedDesign, metadata: { ...savedDesign.metadata, usage: { estimated_cost_usd: 0 } } },
  { ...savedDesign, design_system: { overview: { identity: 'Incomplete' } } },
  { ...savedDesign, exports: { css_variables: 123 } },
  { ...savedDesign, telemetry: { final: true, usage_status: 'not_called' } },
])('rejects malformed result envelopes before rendering them', async payload => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(payload))
  await expect(analyzeWebsite('https://example.com', new AbortController().signal))
    .rejects.toMatchObject({ issue: { code: 'INVALID_RESULT', retryable: false } })
})

it('keeps server error details but discards malformed telemetry', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ detail: { code: 'CAPTURE_INCOMPLETE', message: 'Required assets failed.' }, telemetry: { demo_budget: {} } }, { status: 422 }))
  await expect(analyzeWebsite('https://example.com', new AbortController().signal)).rejects.toMatchObject({ issue: { code: 'CAPTURE_INCOMPLETE', telemetry: undefined } })
})

it('does not start a request that has already been cancelled', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
  const controller = new AbortController()
  controller.abort()
  await expect(analyzeWebsite('https://example.com', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('honors cancellation while decoding a valid JSON result', async () => {
  const controller = new AbortController()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, headers: new Headers(), json: async () => { controller.abort(); return savedDesign } } as Response)
  await expect(analyzeWebsite('https://example.com', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('turns a null provider catalog into a recoverable settings error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(null))
  await expect(getProviders(new AbortController().signal)).rejects.toThrow('Provider settings could not be loaded.')
})

it('rejects partial quota snapshots rather than displaying NaN or invented capacity', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ analyses: {}, capture: {}, concurrency: {}, per_ip: {}, resets_at: 'not-a-date' }))
  await expect(getSharedQuota(new AbortController().signal)).rejects.toThrow('incomplete availability data')
})
