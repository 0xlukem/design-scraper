import TelemetrySummary from './TelemetrySummary'
import type { AnalysisResult, AnalysisUsage, AnalysisTelemetry, AppMode, MixBias } from '../types'
import type { AnalysisIssue } from '../analysisError'
import { providerNames, type Provider } from '../byok'

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
  mode?: AppMode
  bias?: MixBias
  result?: AnalysisResult
  issue?: AnalysisIssue
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
    {entries.length === 0 ? <div className="usage-empty"><p>No analyses in this session.</p><a href="#/analyze" className="action-button">Analyze a website</a><a href="#/library" className="text-button">Explore saved designs</a></div> : <>
      <ol className="session-runs" aria-label="Analysis history">
        {[...entries].reverse().map(entry => <li key={entry.id} className="session-run">
          <div className="run-overview">
            <div className="run-identity"><strong>{entry.sources?.map(url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }).join(' + ') || 'Analysis'}</strong><span>#{entry.id} · {entry.startedAt ? new Date(entry.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Time unavailable'}</span></div>
            <span className={`run-outcome run-outcome-${entry.outcome}`}>{entry.requestSent === false ? 'Not sent' : entry.outcome === 'cancelled' ? 'Stopped waiting' : entry.outcome === 'completed' ? 'Completed' : 'Failed'}</span>
            <div className="run-funding"><strong>{entry.funding === 'demo' ? 'Included' : estimateLabel(costOf(entry))}</strong><span>{entry.funding === 'demo' ? 'Covered by Design Scraper' : `${providerNames[entry.provider as Provider] || entry.provider} · Your API key`}</span>{entry.funding === 'byok' && (entry.telemetry?.generation_attempts || 0) > 1 && <small>Partial estimate</small>}</div>
            {(entry.result || entry.issue || entry.mode) && <a id={`open-run-${entry.id}`} href={`#/activity/${entry.id}`} className="secondary-button" aria-label={`${entry.result ? 'View result' : entry.issue ? 'Review issue' : 'View activity'} for analysis #${entry.id}`}>{entry.result ? 'View result' : entry.issue ? 'Review issue' : 'View activity'}</a>}
          </div>
          <details className="run-disclosure"><summary>Run details<span className="sr-only"> for analysis #{entry.id}</span></summary>
              <div className="run-detail-body">
              <div className="run-source-list">{entry.sources?.map(url => <p key={url}>{url}</p>)}</div>
              <dl className="run-details">
                <div><dt>Estimated AI cost</dt><dd>{estimateLabel(costOf(entry))}{entry.funding === 'demo' && ' · covered by Design Scraper'}</dd></div>
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
              </div>
            </details>
          </li>)}
      </ol>
      <details className="usage-subtotals"><summary>Estimated subtotals</summary><div className="usage-totals">{[...groups].map(([key, group]) => <div key={key}>
        <span>{group.label} · {group.count} requests</span><strong>{group.known ? estimateLabel(group.cost) : 'Unavailable'}</strong>
        {group.unknown > 0 && <small>{group.unknown} with unknown or incomplete cost{group.known ? ' · partial subtotal' : ''}</small>}
      </div>)}</div></details>
    </>}
    <details className="provider-rates"><summary>How costs are calculated</summary><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">Calls count provider dispatch attempts, including failed requests. Auxiliary calls such as Gemini countTokens are separate from generations. Cancelled requests show the last received counters; final usage may be higher. Ledger reservations are not measured provider consumption. Older responses may have unavailable telemetry.</p></details>
  </section>
}
