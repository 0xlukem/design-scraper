import { readAnalysisStream } from './analysisStream'
import type { AnalysisResult, AnalysisProgress, MixBias } from './types'
import { AnalysisError, makeIssue, retryDeadline } from './analysisError'
import { createByokLimiter, secureByokTransport, type ByokCredentials, type ProviderOption } from './byok'
import { isAnalysisResult, isOwnerBudget, isPublicQuota, validTelemetry } from './responseValidation'

const apiBaseUrl = import.meta.env.VITE_API_URL || ''
const reserveByok = createByokLimiter()
export const byokAvailable = () => secureByokTransport(apiBaseUrl)

export async function getProviders(signal: AbortSignal): Promise<ProviderOption[]> {
  const response = await fetch(`${apiBaseUrl}/api/providers`, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error('Provider settings could not be loaded. Try again.')
  const payload = await response.json()
  if (!Array.isArray(payload?.providers) || payload.providers.length !== 4 ||
    new Set(payload.providers.map((p: ProviderOption) => p?.provider)).size !== 4 ||
    !payload.providers.every((p: ProviderOption) => p && ['gemini', 'anthropic', 'openai', 'xai'].includes(p.provider) &&
      typeof p.model === 'string' && p.model.length > 0 &&
      [p.inputPrice, p.outputPrice].every(v => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0))))
    throw new Error('Provider settings could not be loaded. Try again.')
  signal.throwIfAborted()
  return payload.providers
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as Record<string, unknown>
  const detail = record.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const message = (detail as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  if (typeof record.error === 'string') return record.error
  return fallback
}

async function postAnalysis(
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  credentials?: ByokCredentials,
  onProgress?: (progress: AnalysisProgress) => void,
): Promise<AnalysisResult> {
  signal.throwIfAborted()
  const funding = credentials ? 'byok' as const : 'demo' as const
  if (credentials && !byokAvailable()) throw new AnalysisError(makeIssue('BYOK_HTTPS_REQUIRED', 'Using your own key requires an HTTPS page and API.', false, null, { funding, requestSent: false }))
  if (credentials && (!['gemini', 'anthropic', 'openai', 'xai'].includes(credentials.provider) || !/^[\x21-\x7e]{8,512}$/.test(credentials.key)))
    throw new AnalysisError(makeIssue('BYOK_INVALID_KEY', 'Choose a supported provider and enter a valid key without spaces.', false, null, { funding, requestSent: false }))
  const release = credentials ? reserveByok() : undefined
  try {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(credentials ? { 'X-AI-Provider': credentials.provider, 'X-AI-Key': credentials.key } : {}) },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    body: JSON.stringify(body),
    signal,
  })

  let payload: unknown
  let failed = !response.ok
  let retryAfter = response.headers.get('Retry-After')
  try {
    if (response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const event = await readAnalysisStream(response, signal, onProgress)
      payload = event.payload
      failed = event.type === 'error'
      retryAfter = event.retry_after || null
    } else payload = await response.json()
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    throw new AnalysisError(makeIssue('UNREADABLE_RESPONSE', 'The server returned an unreadable response.', false, null, { funding, requestSent: true }))
  }

  if (failed) {
    const detail = (payload as { detail?: { code?: unknown; retryable?: unknown } })?.detail
    const code = typeof detail?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(detail.code) ? detail.code : 'ANALYSIS_FAILED'
    let message = errorMessage(payload, 'The analysis could not be completed.')
    if (credentials) {
      message = message.split(credentials.key).join('[redacted]')
      if (code === 'PROVIDER_AUTH_ERROR') message = 'Your key was rejected. Check the selected provider, key and model permissions. The shared key was not used.'
      if (code === 'PROVIDER_QUOTA_EXHAUSTED') message = 'Your provider account has reached a quota or rate limit. Check its billing and limits before retrying.'
    }
    throw new AnalysisError(makeIssue(code, message, detail?.retryable === true, retryDeadline(retryAfter), { funding, requestSent: true, telemetry: validTelemetry((payload as AnalysisResult)?.telemetry) }))
  }

  const result = payload as AnalysisResult
  if (!await isAnalysisResult(result)) {
    throw new AnalysisError(makeIssue('INVALID_RESULT', 'The server returned an incomplete or invalid design result.', false, null, { funding, requestSent: true, telemetry: validTelemetry(result?.telemetry) }))
  }
  signal.throwIfAborted()
  return result
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof TypeError) throw new AnalysisError(makeIssue('NETWORK_ERROR', 'The connection ended before a result was received.', false, null, { funding, requestSent: true }))
    throw error
  } finally { release?.() }
}

export function analyzeWebsite(url: string, signal: AbortSignal, credentials?: ByokCredentials, onProgress?: (progress: AnalysisProgress) => void) {
  return postAnalysis('/api/analyze', { url }, signal, credentials, onProgress)
}

export function mixWebsites(
  url1: string,
  url2: string,
  bias: MixBias,
  signal: AbortSignal,
  credentials?: ByokCredentials,
  onProgress?: (progress: AnalysisProgress) => void,
) {
  return postAnalysis(
    '/api/mix',
    { url_1: url1, url_2: url2, bias },
    signal,
    credentials,
    onProgress,
  )
}

export async function getSharedQuota(signal: AbortSignal): Promise<import('../../cloudflare-backend/src/telemetry-contract').PublicQuota> {
  const response = await fetch(`${apiBaseUrl}/api/quotas`, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('Shared allowance could not be loaded.')
  const payload = await response.json()
  if (!isPublicQuota(payload)) throw new Error('Shared allowance is unavailable on this server.')
  signal.throwIfAborted()
  return payload
}

export async function getOwnerBudget(token: string, signal: AbortSignal): Promise<import('../../cloudflare-backend/src/telemetry-contract').BudgetStatus> {
  if (!byokAvailable()) throw new Error('Owner diagnostics require an HTTPS page and API.')
  if (!/^[\x21-\x7e]{8,512}$/.test(token)) throw new Error('Enter a valid administrative token.')
  const response = await fetch(`${apiBaseUrl}/api/diagnostics/budget`, { signal, headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error(response.status === 401 ? 'Administrative authentication was rejected.' : 'Owner budget could not be loaded.')
  const payload = await response.json()
  if (!isOwnerBudget(payload)) throw new Error('Budget telemetry is unavailable on this server.')
  signal.throwIfAborted()
  return payload
}
