import { useEffect, useState } from 'react'
import { getSharedQuota } from '../api'
import type { PublicQuota } from '../../../cloudflare-backend/src/telemetry-contract'
import './site-availability.css'

export default function SharedBudget({ revision, active }: { revision: number; active: boolean }) {
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
  const status = error ? 'Could not update' : loading ? 'Checking availability…' : !quota ? 'Not checked'
    : exhausted ? 'Daily capacity reached' : busy ? 'An analysis is running' : !quota.demo_budget_available ? 'Your own key needed' : 'Available'
  const time = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

  return <section className="session-usage site-availability" aria-labelledby="shared-budget-title">
    <div className="availability-heading">
      <div><h2 id="shared-budget-title">Site API availability</h2><p>Available capacity for everyone using this site.</p></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{loading ? 'Refreshing…' : error ? 'Try again' : 'Refresh availability'}</button>
    </div>
    <div className="availability-status" role="status" data-state={error ? 'error' : loading ? 'loading' : exhausted || busy || quota && !quota.demo_budget_available ? 'limited' : 'ready'}>
      <strong>{status}</strong>
      {error ? <p>{error} {quota ? 'The figures below are from the last successful update.' : 'Availability is unknown; this does not mean the quota is used up.'}</p>
        : exhausted ? <p>Wait for the daily reset. Your own API key also uses the site’s analysis and capture limits.</p>
        : busy ? <p>Try again when the current analysis finishes.</p>
        : quota && !quota.demo_budget_available ? <p>The site’s shared AI allowance cannot cover another analysis. You can use your own key while analysis and capture capacity remain.</p>
        : <p>Checking this counter does not run an analysis or use AI credit.</p>}
    </div>
    <dl className="availability-metrics" aria-label={error && quota ? 'Last known site capacity' : 'Site capacity'} aria-busy={loading}>
      <div><dt>Analyses left today</dt><dd>{quota ? quota.analyses.remaining : '—'}</dd><dd className="availability-metric-note">{quota ? `of ${quota.analyses.limit} shared analyses` : 'Waiting for the site API'}</dd></div>
      <div><dt>Capture time left</dt><dd>{quota ? `${Number((quota.capture.remaining_ms / 60000).toFixed(2))} min` : '—'}</dd><dd className="availability-metric-note">{quota ? `of ${Number((quota.capture.limit_ms / 60000).toFixed(2))} minutes today` : 'Waiting for the site API'}</dd></div>
      <div><dt>Analyses running</dt><dd>{quota ? `${quota.concurrency.active} / ${quota.concurrency.limit}` : '—'}</dd><dd className="availability-metric-note">Shared processing capacity</dd></div>
      <div><dt>Site AI allowance</dt><dd className="availability-budget">{quota ? quota.demo_budget_available ? 'Available' : 'At capacity' : '—'}</dd><dd className="availability-metric-note">For analyses using the site’s API key</dd></div>
    </dl>
    {quota && <div className="availability-details">
      <p><strong>Daily reset</strong> <time dateTime={quota.resets_at}>{new Date(quota.resets_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, {time(new Date(quota.resets_at))}</time></p>
      <p><strong>Per visitor</strong> Up to {quota.per_ip.hourly_limit} analyses/hour and {quota.per_ip.daily_limit}/day.</p>
      {updatedAt && <p className="availability-updated">Last updated <time dateTime={updatedAt.toISOString()}>{time(updatedAt)}</time>. Counts include reserved capacity and may change before you submit.</p>}
    </div>}
    <p className="availability-key-note"><strong>Using your own API key?</strong> AI usage is charged to your provider account. The site’s analysis and capture limits still apply. Your provider’s balance is not shown here.</p>
  </section>
}
