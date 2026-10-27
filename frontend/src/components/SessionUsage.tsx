import TelemetrySummary from './TelemetrySummary'
import type { AnalysisUsage, AnalysisTelemetry } from '../types'

export interface UsageEntry {
  id: number
  sources?: string[]
  startedAt?: number
  durationMs?: number
  funding: 'demo' | 'byok'
  provider: string
  outcome: 'completed' | 'failed' | 'cancelled'
  usage?: AnalysisUsage | null
  telemetry?: AnalysisTelemetry
  requestSent?: boolean
}

export const estimateLabel = (cost: number | null) => cost === null ? 'Unknown' : `US$${cost.toFixed(5)}`

const noAi = (entry: UsageEntry) => entry.requestSent === false || entry.telemetry?.final && entry.telemetry.usage_status === 'not_called'
const costOf = (entry: UsageEntry) => noAi(entry) ? 0 : entry.usage?.cost_status === 'estimated' ? entry.usage.estimated_cost_usd : null

export default function SessionUsage({ entries }: { entries: UsageEntry[] }) {
  const groups = new Map<string, { label: string; count: number; known: number; cost: number; unknown: number }>()
  for (const entry of entries) {
    const key = `${entry.funding}:${entry.provider}`
    const group = groups.get(key) || { label: `${entry.funding === 'demo' ? 'Design Scraper' : 'Your API key'} / ${entry.provider}`, count: 0, known: 0, cost: 0, unknown: 0 }
    group.count++
    const cost = costOf(entry)
    if (cost != null) { group.cost += cost; group.known++; if ((entry.telemetry?.generation_attempts || 0) > 1) group.unknown++ } else group.unknown++
    groups.set(key, group)
  }
  return <section className="session-usage" aria-labelledby="session-usage-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 id="session-usage-title" className="text-2xl font-semibold">Session activity</h2>
      <span className="font-mono text-xs">Cleared on reload</span>
    </div>
    <p className="mt-3 max-w-[80ch] text-sm leading-relaxed">Costs describe AI usage, not a bill. Design Scraper covers included usage.</p>
    {entries.length === 0 ? <p className="usage-empty">No analyses yet. Your activity will appear here.</p> : <>
      <details className="usage-subtotals"><summary>Estimated subtotals</summary><div className="usage-totals">{[...groups].map(([key, group]) => <div key={key}>
        <span>{group.label} · {group.count} requests</span><strong>{group.known ? estimateLabel(group.cost) : 'Unavailable'}</strong>
        {group.unknown > 0 && <small>{group.unknown} with unknown or incomplete cost{group.known ? ' · partial subtotal' : ''}</small>}
      </div>)}</div></details>
      <div className="session-table-wrap" role="region" aria-label="Session consumption table">
        <table className="consumption-table session-table"><caption className="sr-only">Analysis requests and reported token usage</caption>
          <thead><tr>{['Website', 'Started', 'Status', 'Provider', 'Estimated USD', 'Details'].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
          <tbody>{entries.map(entry => <tr key={entry.id}>
            <th scope="row"><span>#{entry.id}</span>{entry.sources?.map(url => <span className="run-source" key={url}>{url}</span>) || <span>Analysis</span>}</th>
            <td data-label="Started">{entry.startedAt ? new Date(entry.startedAt).toLocaleString() : 'Unavailable'}</td>
            <td data-label="Status">{entry.requestSent === false ? 'Not sent' : entry.outcome === 'cancelled' ? 'Stopped waiting' : entry.outcome === 'completed' ? 'Completed' : 'Failed'}</td>
            <td data-label="Run with">{entry.provider}<small>{entry.funding === 'byok' ? 'Your API key' : 'Design Scraper · Included'}</small></td>
            <td data-label="Estimated USD">{estimateLabel(costOf(entry))}{(entry.telemetry?.generation_attempts || 0) > 1 && <small>Partial estimate</small>}</td>
            <td className="session-details"><details><summary>Run details<span className="sr-only"> for analysis #{entry.id}</span></summary>
              <dl className="run-details">
                <div><dt>Model</dt><dd>{entry.usage?.model || entry.telemetry?.model || 'Unavailable'}</dd></div>
                <div><dt>Time waiting</dt><dd>{entry.durationMs == null ? 'Unavailable' : `${(entry.durationMs / 1000).toFixed(1)}s`}</dd></div>
                {entry.usage && <div><dt>Token measurement</dt><dd>{entry.usage.status === 'exact' ? 'Exact provider usage' : 'Estimated token usage'}</dd></div>}
                <div><dt>Input tokens</dt><dd>{entry.usage?.input_tokens.toLocaleString('en-US') ?? (noAi(entry) ? '0' : 'Unknown')}</dd></div>
                <div><dt>Output tokens</dt><dd>{entry.usage?.output_tokens.toLocaleString('en-US') ?? (noAi(entry) ? '0' : 'Unknown')}</dd></div>
                <div><dt>Reasoning tokens</dt><dd>{entry.usage?.reasoning_tokens?.toLocaleString('en-US') ?? 'Unavailable'}</dd></div>
              </dl>
              {entry.requestSent === false ? <p>This request was blocked locally before sending. No AI provider was called and no analysis quota was used.</p> : entry.telemetry ? <TelemetrySummary telemetry={entry.telemetry} /> : <p>Detailed counters are unavailable.</p>}
              {!!entry.usage?.notes.length && <ul className="usage-summary-notes">{entry.usage.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
              {entry.outcome === 'cancelled' && <p>Last received usage. Remote work may continue and add cost.</p>}
              {(entry.telemetry?.generation_attempts || 0) > 1 && <p>Completed response only; earlier attempts may add cost.</p>}
            </details></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <details className="provider-rates"><summary>How costs are calculated</summary><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">Calls count provider dispatch attempts, including failed requests. Auxiliary calls such as Gemini countTokens are separate from generations. Cancelled requests show the last received counters; final usage may be higher. Ledger reservations are not measured provider consumption. Older responses may have unavailable telemetry.</p></details>
  </section>
}
