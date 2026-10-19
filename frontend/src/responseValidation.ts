import type { AnalysisResult, AnalysisTelemetry, AnalysisUsage } from './types'
import type { BudgetStatus, PublicQuota } from '../../cloudflare-backend/src/telemetry-contract'

// The network boundary is untyped. Check values before React renders them;
// malformed usage must never become a zero cost or a completed analysis.
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const texts = (value: unknown) => Array.isArray(value) && value.every(text)
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value))
const optional = (value: unknown, valid: (value: unknown) => boolean) => value == null || valid(value)

export function isAnalysisUsage(value: unknown): value is AnalysisUsage {
  if (!record(value)) return false
  return optional(value.funding, v => v === 'demo' || v === 'byok') &&
    text(value.provider) && text(value.model) &&
    ['input_tokens', 'output_tokens', 'total_tokens', 'sources_count', 'screenshots_sent'].every(key => count(value[key])) &&
    (value.reasoning_tokens === null || count(value.reasoning_tokens)) &&
    (value.status === 'exact' || value.status === 'estimated') &&
    (value.cost_status === 'estimated' ? amount(value.estimated_cost_usd) : value.cost_status === 'unavailable' && value.estimated_cost_usd === null) &&
    (value.pricing_source === null || text(value.pricing_source)) && texts(value.notes)
}

export function isAnalysisTelemetry(value: unknown): value is AnalysisTelemetry {
  if (!record(value)) return false
  const shape = (value.funding === 'demo' || value.funding === 'byok') && text(value.provider) && text(value.model) &&
    ['provider_calls', 'generation_attempts', 'auxiliary_calls', 'browser_reserved_ms'].every(key => count(value[key])) &&
    typeof value.final === 'boolean' && typeof value.usage_status === 'string' && ['pending', 'not_called', 'reported', 'unavailable'].includes(value.usage_status) &&
    (value.usage === null || isAnalysisUsage(value.usage)) &&
    (value.browser_ms === null || amount(value.browser_ms)) &&
    (value.demo_budget === null || record(value.demo_budget) &&
      count(value.demo_budget.tokens_charged_or_reserved) && count(value.demo_budget.micro_usd_charged_or_reserved) &&
      typeof value.demo_budget.conservative === 'boolean')
  if (!shape) return false
  const t = value as unknown as AnalysisTelemetry
  return t.provider_calls === t.generation_attempts + t.auxiliary_calls &&
    (t.usage_status !== 'not_called' || t.final && t.provider_calls === 0 && t.usage === null) &&
    (t.usage_status !== 'reported' || t.final && t.usage !== null) &&
    (t.usage_status !== 'pending' || !t.final)
}

function isMetadata(value: unknown) {
  if (!record(value) || !optional(value.usage, isAnalysisUsage)) return false
  if (value.mode === 'mix') {
    return typeof value.bias === 'number' && [-50, -25, 0, 25, 50].includes(value.bias) && record(value.weights) &&
      count(value.weights.web_1) && count(value.weights.web_2) && value.weights.web_1 + value.weights.web_2 === 100 &&
      Array.isArray(value.sources) && value.sources.length === 2 &&
      new Set(value.sources.map(source => record(source) ? source.slot : null)).size === 2 &&
      value.sources.every(source => record(source) && (source.slot === 'web_1' || source.slot === 'web_2') &&
        text(source.url) && text(source.title) && text(source.description) && count(source.influence) && source.influence <= 100 &&
        (source.status === 'analyzed' || source.status === 'excluded') && count(source.colors_extracted) && count(source.fonts_extracted))
  }
  return text(value.url) && text(value.title) && optional(value.description, text) &&
    optional(value.colors_extracted, count) && optional(value.fonts_extracted, count)
}

export async function isAnalysisResult(value: unknown): Promise<boolean> {
  if (!record(value) || value.success !== true || !text(value.design_md) || !value.design_md.trim() ||
    !isMetadata(value.metadata) || !optional(value.telemetry, isAnalysisTelemetry)) return false
  if (!optional(value.documents, documents => record(documents) && text(documents.compact) && text(documents.extended)) ||
    !optional(value.exports, exports => record(exports) && ['css_variables', 'tailwind', 'design_tokens'].every(key => text(exports[key])))) return false
  if (value.design_system != null) {
    // Reuse the generated canonical validator. Loading it only for a result
    // keeps schema machinery out of the initial interactive UI bundle.
    const { default: validate } = await import('../../cloudflare-backend/src/domain/validate.js')
    if (!validate(value.design_system)) return false
  }
  return true
}

export function validTelemetry(value: unknown): AnalysisResult['telemetry'] {
  return isAnalysisTelemetry(value) ? value : undefined
}

export function isPublicQuota(value: unknown): value is PublicQuota {
  if (!record(value)) return false
  const analyses = value.analyses, capture = value.capture
  return date(value.day) && date(value.resets_at) && typeof value.demo_budget_available === 'boolean' &&
    record(analyses) && ['used', 'limit', 'remaining'].every(key => count(analyses[key])) &&
    record(capture) && ['used_or_reserved_ms', 'limit_ms', 'remaining_ms'].every(key => amount(capture[key])) &&
    record(value.concurrency) && count(value.concurrency.active) && count(value.concurrency.limit) &&
    record(value.per_ip) && count(value.per_ip.hourly_limit) && count(value.per_ip.daily_limit)
}

export function isOwnerBudget(value: unknown): value is BudgetStatus {
  if (!record(value) || !date(value.day) || value.costStatus !== 'estimated' ||
    !['admitted', 'dailyLimit', 'ipHourlyLimit', 'ipDailyLimit', 'browserMsUsedOrReserved', 'browserMsLimit',
      'tokensUsedOrReserved', 'dailyTokenLimit', 'dailyMicroUsdUsedOrReserved', 'totalMicroUsdUsedOrReserved',
      'dailyMicroUsdLimit', 'totalMicroUsdLimit', 'active'].every(key => count(value[key]))) return false
  const reservations = value.activeReservations, calls = value.demoCalls
  return record(reservations) && ['browserMs', 'tokens', 'microUsd'].every(key => count(reservations[key])) &&
    record(calls) && date(calls.since) &&
    [calls.daily, calls.total].every(counters => record(counters) && count(counters.generation) && count(counters.auxiliary))
}
