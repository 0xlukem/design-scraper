import TelemetrySummary from './TelemetrySummary'
import { ArrowClockwise, WarningOctagon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { AnalysisIssue } from '../analysisError'

export default function AnalysisErrorPanel({ issue, onRetry, disabled, onReviewSettings, onReviewUrl }: { issue: AnalysisIssue; onRetry: () => void; disabled: boolean; onReviewSettings?: () => void; onReviewUrl?: () => void }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!issue.retryAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [issue.retryAt])
  const remaining = Math.max(0, Math.ceil(((issue.retryAt || 0) - now) / 1000))
  return <section className="error-state" role="alert">
    <WarningOctagon size={32} weight="bold" aria-hidden="true" />
    <div className="min-w-0">
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{issue.category}</h2>

      <details className="provider-rates"><summary>Error details</summary><p>{issue.message}</p><p>{issue.guidance}</p><p className="mt-3 font-mono text-xs break-all">Issue: {issue.code}</p>{issue.telemetry && <TelemetrySummary telemetry={issue.telemetry} />}</details>
      <p className="mt-4 max-w-[65ch] text-sm leading-relaxed">{issue.guidance.split('. ')[0] + '.'}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {issue.retryable && <button type="button" onClick={onRetry} disabled={disabled || remaining > 0} className="secondary-button">
          <ArrowClockwise size={18} aria-hidden="true" />{remaining > 0 ? `Retry in ${remaining}s` : 'Retry'}
        </button>}
        {/PROVIDER|AI_|BYOK|AUTH/.test(issue.code)
          ? <button type="button" className="secondary-button" onClick={onReviewSettings}>Review settings</button>
          : <button type="button" className="secondary-button" onClick={onReviewUrl}>Review URL</button>}
        <a className="secondary-button" href="#/library">Open saved designs</a>
      </div>
      {issue.retryable && <p className="mt-3 text-xs">A retry is a new analysis and may consume quota.</p>}
    </div>
  </section>
}
