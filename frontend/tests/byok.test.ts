import { expect, it, vi, afterEach } from 'vitest'
import { createByokLimiter, secureByokTransport } from '../src/byok'
import { analyzeWebsite } from '../src/api'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('requires HTTPS on both sides without a localhost exception', () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://ui.example', href: 'https://ui.example/' } })
  expect(secureByokTransport('https://api.example')).toBe(true)
  expect(secureByokTransport('http://127.0.0.1:8787')).toBe(false)
  expect(secureByokTransport('https://')).toBe(false)
  expect(secureByokTransport('https://secret@api.example')).toBe(false)
  vi.stubGlobal('window', { location: { protocol: 'http:', origin: 'http://localhost', href: 'http://localhost/' } })
  expect(secureByokTransport('https://api.example')).toBe(false)
})
it('refuses to send any key over HTTP', async () => {
  const f = vi.spyOn(globalThis, 'fetch')
  await expect(analyzeWebsite('https://example.com', AbortSignal.timeout(1000), { provider: 'gemini', key: 'test-own-key' })).rejects.toThrow(/HTTPS/)
  expect(f).not.toHaveBeenCalled()
})
it('sends only a paired credential header over HTTPS, never in body or URL', async () => {
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://ui.example', href: 'https://ui.example/' } })
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: true, design_md: '# Fixture', metadata: { url: 'https://example.com', title: 'Fixture' } }))
  await analyzeWebsite('https://example.com', AbortSignal.timeout(1000), { provider: 'openai', key: 'test-own-key' })
  const [url, options] = f.mock.calls[0]
  expect(String(url)).not.toContain('test-own-key')
  expect(String(options?.body)).not.toContain('test-own-key')
  expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
  expect(new Headers(options?.headers).get('X-AI-Key')).toBe('test-own-key')
  expect(new Headers(options?.headers).get('X-AI-Provider')).toBe('openai')
})
it('limits requests across providers and both modes without retaining keys', () => {
  let time = Date.UTC(2026, 8, 10, 10)
  const reserve = createByokLimiter(() => time)
  const release = reserve()
  expect(() => reserve()).toThrow(/already running/)
  release()
  reserve()(); reserve()()
  expect(() => reserve()).toThrow(/3 BYOK attempts per hour/)
  time += 3600001
  reserve()(); reserve()()
  expect(() => reserve()).toThrow(/5 BYOK attempts per UTC day/)
  time += 86400000
  expect(() => reserve()()).not.toThrow()
})
it('does not reset an hourly limit at UTC midnight', () => {
  let time = Date.UTC(2026, 8, 10, 23, 59)
  const reserve = createByokLimiter(() => time)
  reserve()(); reserve()(); reserve()()
  time += 120000
  expect(() => reserve()).toThrow(/3 BYOK attempts per hour/)
})
