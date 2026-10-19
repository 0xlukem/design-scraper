import type { AnalysisTelemetry } from '../types'
import { estimateLabel } from './SessionUsage'
export default function TelemetrySummary({ telemetry: t }: { telemetry: AnalysisTelemetry }) {
  return <div className="mt-4 text-sm leading-relaxed" aria-label="Analysis telemetry">
    <p>Provider calls: <strong>{t.provider_calls}</strong> · Generation attempts: <strong>{t.generation_attempts}</strong> · Auxiliary calls: <strong>{t.auxiliary_calls}</strong></p>
    <p>{t.final ? t.usage_status === 'not_called' ? 'No AI provider was called. AI consumption: 0 tokens / US$0.' : t.usage_status === 'reported' ? 'Provider usage was received.' : 'The provider was called; token usage and cost could not be recovered.' : 'Last confirmed counters. Remote work may continue; final usage is unknown.'}</p>
    {t.demo_budget && <p className="mt-2 text-xs">Shared budget: {t.demo_budget.tokens_charged_or_reserved.toLocaleString()} tokens / {estimateLabel(t.demo_budget.micro_usd_charged_or_reserved / 1e6)} {t.demo_budget.conservative ? 'charged or conservatively reserved' : 'settled'}. Always estimated.</p>}
    {t.browser_reserved_ms > 0 && <p className="text-xs">Capture reservation: {(t.browser_reserved_ms / 1000).toFixed(1)} seconds{t.final ? ' retained because cleanup could not be confirmed' : ' while work is active'}.</p>}
  </div>
}
