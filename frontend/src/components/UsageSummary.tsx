import { useId } from 'react'
import type { AnalysisUsage } from '../types'

interface UsageSummaryProps {
  usage: AnalysisUsage
}

const numberFormatter = new Intl.NumberFormat('en-US')

function formatTokens(value: number) {
  return numberFormatter.format(value)
}

function formatCost(value: number | null) {
  if (value === null) return 'Unavailable'
  if (value > 0 && value < 0.01) return '< US$0.01'
  return `US$${value.toFixed(2)}`
}

export default function UsageSummary({ usage }: UsageSummaryProps) {
  const titleId = useId()
  const measurementLabel = usage.status === 'exact' ? 'Exact provider usage' : 'Estimated usage'
  const lead = usage.status === 'exact' ? 'This analysis used' : 'This analysis used approximately'

  return (
    <section className="usage-summary" aria-labelledby={titleId}>
      <div className="usage-summary-heading">
        <div>
          <p className="eyebrow"></p>
          <h3 id={titleId}>
            {lead} {formatTokens(usage.total_tokens)} tokens.
          </h3>
        </div>
        <span
          className={`usage-status usage-status-${usage.status}`}
          aria-label={measurementLabel}
        >
          {measurementLabel}
        </span>
      </div>

      <div className="usage-summary-grid">
        <div>
          <span>Input</span>
          <strong>{formatTokens(usage.input_tokens)}</strong>
        </div>
        <div>
          <span>Output</span>
          <strong>{formatTokens(usage.output_tokens)}</strong>
        </div>
        {usage.reasoning_tokens !== null && (
          <div>
            <span>Reasoning</span>
            <strong>{formatTokens(usage.reasoning_tokens)}</strong>
          </div>
        )}
        <div>
          <span>Estimated cost</span>
          <strong>{formatCost(usage.estimated_cost_usd)}</strong>
          <small className="usage-cost-disclaimer">Always estimated</small>
        </div>
        <div>
          <span>Sources / screenshots</span>
          <strong>
            {usage.sources_count} / {usage.screenshots_sent}
          </strong>
        </div>
      </div>

      <p className="usage-summary-note">
        {usage.funding === 'byok' ? 'Your key · charged to your provider account. ' : usage.funding === 'demo' ? 'Shared allowance budget. ' : ''}
        Provider: <strong>{usage.provider}</strong> · Model:{' '}
        <strong>{usage.model}</strong>. Consumption depends on the model and the
        size of the screenshots. Cost is an estimate, not a billing statement.
      </p>
      {usage.notes.length > 0 && (
        <ul className="usage-summary-notes">
          {usage.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
