import { useEffect, useState } from 'react'
import { getSharedQuota } from '../api'
import type { PublicQuota } from '../../../cloudflare-backend/src/telemetry-contract'
import './site-availability.css'

export default function SharedBudget({ revision, active, usingOwnKey = false, onUseKey }: { revision: number; active: boolean; usingOwnKey?: boolean; onUseKey?: () => void }) {
  const [quota, setQuota] = useState<PublicQuota | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    getSharedQuota(controller.signal).then(value => {
      if (!controller.signal.aborted) { setQuota(value); setUpdatedAt(new Date()) }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The site API could not be reached. Try again.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, refresh, revision])

  const exhausted = quota && (quota.analyses.remaining === 0 || quota.capture.remaining_ms === 0)
  const busy = quota && quota.concurrency.active >= quota.concurrency.limit
  const status = error ? 'Could not check' : loading ? 'Checking availability…' : !quota ? 'Not checked'
    : exhausted ? 'Daily limit reached' : busy ? 'Busy' : !quota.demo_budget_available && !usingOwnKey ? 'Included AI unavailable' : 'Available'
  const time = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

  return <section className="session-usage site-availability" aria-labelledby="shared-budget-title">
    <div className="availability-heading">
      <div><h2 id="shared-budget-title">Service availability</h2></div>
      <button className="text-button" type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{loading ? 'Checking…' : 'Check availability'}</button>
    </div>
    <div className="availability-status" role="status" data-state={error ? 'error' : loading ? 'loading' : exhausted || busy || quota && !quota.demo_budget_available && !usingOwnKey ? 'limited' : 'ready'}>
      <strong>{status}</strong>
      {error ? <p>We couldn’t check availability. Try checking again.{quota && ' Limits below are from the last successful update.'}</p>
        : exhausted ? <p>Wait for the daily reset. Your own API key also uses the site’s analysis and capture limits.</p>
        : busy ? <p>Try again when the current analysis finishes.</p>
        : quota && !quota.demo_budget_available && !usingOwnKey ? <p>Included AI is at capacity. You can continue with your own key.{onUseKey && <button type="button" className="text-button" onClick={onUseKey}>Set up my API key</button>}</p>
        : null}
    </div>
    <details className="availability-disclosure"><summary>Service limits</summary>
    {error && <p className="field-help">{error}</p>}
    <dl className="availability-metrics" aria-label={error && quota ? 'Last known site capacity' : 'Site capacity'} aria-busy={loading}>
      <div><dt>Analyses left today</dt><dd>{quota ? quota.analyses.remaining : '—'}</dd><dd className="availability-metric-note">{quota ? `of ${quota.analyses.limit} analyses site-wide` : 'Not available yet'}</dd></div>
      <div><dt>Capture time left</dt><dd>{quota ? `${Number((quota.capture.remaining_ms / 60000).toFixed(2))} min` : '—'}</dd><dd className="availability-metric-note">{quota ? `of ${Number((quota.capture.limit_ms / 60000).toFixed(2))} minutes today` : 'Not available yet'}</dd></div>
      <div><dt>Analyses running</dt><dd>{quota ? `${quota.concurrency.active} / ${quota.concurrency.limit}` : '—'}</dd><dd className="availability-metric-note">Shared processing capacity</dd></div>
      <div><dt>Included AI</dt><dd className="availability-budget">{quota ? quota.demo_budget_available ? 'Available' : 'At capacity' : '—'}</dd><dd className="availability-metric-note">Covered by Design Scraper</dd></div>
    </dl>
    {quota && <div className="availability-details">
      <p><strong>Daily reset</strong> <time dateTime={quota.resets_at}>{new Date(quota.resets_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, {time(new Date(quota.resets_at))}</time></p>
      <p><strong>Per visitor</strong> Up to {quota.per_ip.hourly_limit} analyses/hour and {quota.per_ip.daily_limit}/day.</p>
      {updatedAt && <p className="availability-updated">Last updated <time dateTime={updatedAt.toISOString()}>{time(updatedAt)}</time>. Counts include reserved capacity and may change before you submit.</p>}
    </div>}
    <p className="availability-key-note">Site limits apply to both Design Scraper and your own API key.</p></details>
  </section>
}
