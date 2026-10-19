export type Provider = 'gemini' | 'anthropic' | 'openai' | 'xai'
export interface ByokCredentials { provider: Provider; key: string }
export interface ProviderOption {
  provider: Provider
  model: string
  inputPrice: number | null
  outputPrice: number | null
}
export const providerNames: Record<Provider, string> = {
  gemini: 'Gemini', anthropic: 'Claude / Anthropic', openai: 'OpenAI', xai: 'Grok / xAI',
}
export function secureByokTransport(apiBase: string) {
  try {
    const api = new URL(apiBase || window.location.origin, window.location.href)
    return window.location.protocol === 'https:' && api.protocol === 'https:' && !api.username && !api.password
  } catch { return false }
}

// This per-tab guard stores only attempt times. The Worker also enforces shared
// IP/day/concurrency limits, so reloading or changing keys cannot bypass them.
export function createByokLimiter(now = Date.now) {
  let attempts: number[] = []
  let active = false
  return () => {
    const time = now()
    attempts = attempts.filter(t => t >= Math.floor(time / 86400000) * 86400000 || t > time - 3600000)
    const context = { funding: 'byok' as const, requestSent: false }
    if (active) throw new AnalysisError(makeIssue('BYOK_REQUEST_ACTIVE', 'A request is already running in this tab.', false, null, context))
    const hourly = attempts.filter(t => t > time - 3600000)
    if (hourly.length >= 3)
      throw new AnalysisError(makeIssue('BYOK_LOCAL_HOURLY_LIMIT', 'This tab has reached its limit of 3 BYOK attempts per hour.', true, Math.min(...hourly) + 3600000, context))
    if (attempts.filter(t => t >= Math.floor(time / 86400000) * 86400000).length >= 5)
      throw new AnalysisError(makeIssue('BYOK_LOCAL_DAILY_LIMIT', 'This tab has reached its limit of 5 BYOK attempts per UTC day.', true, (Math.floor(time / 86400000) + 1) * 86400000, context))
    attempts.push(time)
    active = true
    return () => { active = false }
  }
}
import { AnalysisError, makeIssue } from './analysisError'
