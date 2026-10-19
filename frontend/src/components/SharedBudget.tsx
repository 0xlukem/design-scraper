import { useEffect, useRef, useState } from 'react'
import { byokAvailable, getOwnerBudget, getSharedQuota } from '../api'
import type { BudgetStatus, PublicQuota } from '../../../cloudflare-backend/src/telemetry-contract'
import { estimateLabel } from './SessionUsage'

export default function SharedBudget({ revision }: { revision: number }) {
  const [quota, setQuota] = useState<PublicQuota | null>(null)
  const [requested, setRequested] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [budget, setBudget] = useState<BudgetStatus | null>(null)
  const [adminError, setAdminError] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const tokenInput = useRef<HTMLInputElement>(null)
  const adminController = useRef<AbortController>()
  const secure = byokAvailable()
  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    setLoading(true); setError(''); setQuota(null)
    getSharedQuota(controller.signal).then(value => { if (!controller.signal.aborted) setQuota(value) }).catch(() => {
      if (!controller.signal.aborted) setError('Shared allowance is unavailable. Retry to refresh it.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [requested, refresh, revision])
  useEffect(() => {
    const clear = () => {
      adminController.current?.abort()
      if (tokenInput.current) tokenInput.current.value = ''
      setBudget(null); setAdminError(''); setAdminBusy(false)
    }
    window.addEventListener('pagehide', clear)
    return () => { clear(); window.removeEventListener('pagehide', clear) }
  }, [])
  async function loadOwner() {
    if (adminBusy || !tokenInput.current?.value.trim()) return
    const token = tokenInput.current.value.trim()
    tokenInput.current.value = ''
    const controller = new AbortController()
    adminController.current = controller
    setAdminBusy(true); setAdminError(''); setBudget(null)
    try {
      const value = await getOwnerBudget(token, controller.signal)
      if (!controller.signal.aborted) setBudget(value)
    } catch (e) {
      if (!controller.signal.aborted) setAdminError(e instanceof Error ? e.message : 'Owner budget unavailable.')
    } finally { if (!controller.signal.aborted) setAdminBusy(false) }
  }
  return <section className="session-usage" aria-labelledby="shared-budget-title">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow"></p><h2 id="shared-budget-title" className="mt-2 text-2xl font-semibold">Shared allowance</h2></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => { setRequested(true); setRefresh(n => n + 1) }}>{loading ? 'Refreshing allowance…' : 'Check shared allowance'}</button>
    </div>
    <p className="mt-3 text-sm">All analyses share daily limits and available processing capacity. Checking availability does not start an analysis.</p>
    {error && <p role="status" className="mt-3 text-sm">{error}</p>}
    {quota && <div className="mt-5" role="status">
      <div className="usage-totals">
        <div><span>Daily admissions remaining</span><strong>{quota.analyses.remaining} / {quota.analyses.limit}</strong></div>
        <div><span>Capture time remaining</span><strong>{(quota.capture.remaining_ms / 60000).toFixed(2)} min</strong></div>
        <div><span>Active analyses</span><strong>{quota.concurrency.active} / {quota.concurrency.limit}</strong></div>
      </div>
      <p className="mt-4 text-sm">Per IP: {quota.per_ip.hourly_limit}/hour and {quota.per_ip.daily_limit}/day. Daily reset: {new Date(quota.resets_at).toLocaleString()}.</p>
      <p className="mt-2 text-xs">{quota.demo_budget_available ? 'Shared AI budget has capacity.' : 'Shared AI budget is exhausted; BYOK still uses shared capture limits.'} Snapshot includes reservations, not a guarantee of admission. IP usage and provider availability are checked when submitting.</p>
    </div>}
    <details className="provider-rates"><summary>Owner budget · administrative access</summary>
      <p className="mt-3 text-sm">Shared spending is protected. Visitor BYOK keys cannot unlock this view.</p>
      {!secure ? <p className="mt-3 text-sm">Owner diagnostics require an HTTPS page and API.</p> : <>
        <div className="field-group mt-4"><label className="field-label" htmlFor="owner-token">Administrative token</label><input id="owner-token" ref={tokenInput} className="url-input" type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={adminBusy} /><p className="field-help">Sent only to the protected budget endpoint. Cleared after submission and on navigation; never saved.</p></div>
        <button className="secondary-button mt-3" type="button" disabled={adminBusy} onClick={() => void loadOwner()}>{adminBusy ? 'Loading owner budget…' : 'Load owner budget'}</button>
        {adminError && <p role="alert" className="mt-3 text-sm">{adminError}</p>}
        {budget && <div className="mt-5">
          <p className="mb-3 text-xs sm:hidden">Swipe the table to see generation and auxiliary call counts.</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Administrative budget table"><table className="consumption-table"><caption className="text-left mb-3">Shared allowance ledger · always estimated</caption><thead><tr><th>Period</th><th>Used or reserved</th><th>Limit</th><th>Generation attempts</th><th>Auxiliary calls</th></tr></thead><tbody>
            <tr><th scope="row">Today · {budget.day} UTC</th><td>{estimateLabel(budget.dailyMicroUsdUsedOrReserved / 1e6)}</td><td>{estimateLabel(budget.dailyMicroUsdLimit / 1e6)}</td><td>{budget.demoCalls.daily.generation}</td><td>{budget.demoCalls.daily.auxiliary}</td></tr>
            <tr><th scope="row">Accumulated</th><td>{estimateLabel(budget.totalMicroUsdUsedOrReserved / 1e6)}</td><td>{estimateLabel(budget.totalMicroUsdLimit / 1e6)}</td><td>{budget.demoCalls.total.generation}</td><td>{budget.demoCalls.total.auxiliary}</td></tr>
          </tbody></table></div>
          <p className="mt-3 text-sm">Active reservations: {estimateLabel(budget.activeReservations.microUsd / 1e6)}, {budget.activeReservations.tokens.toLocaleString()} tokens, {(budget.activeReservations.browserMs / 1000).toFixed(1)} seconds of capture.</p>
          <p className="mt-2 text-xs">Totals preserve historical usage and conservative amounts retained after uncertain failures; they are not invoices. Call counters begin {new Date(budget.demoCalls.since).toLocaleString()}; earlier calls were not recorded. BYOK provider calls and spending are excluded.</p>
          <button type="button" className="secondary-button mt-3" onClick={() => setBudget(null)}>Hide owner budget</button>
        </div>}
      </>}
    </details>
  </section>
}
