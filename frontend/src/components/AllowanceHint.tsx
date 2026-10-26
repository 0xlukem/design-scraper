import { useEffect, useState } from 'react'
import { getSharedQuota } from '../api'
import type { PublicQuota } from '../../../cloudflare-backend/src/telemetry-contract'

/**
 * Remaining shared allowance next to the submit button. It loads only after the
 * visitor shows intent (focusing a URL field) and again after each request, so
 * opening the page never contacts the API.
 */
export default function AllowanceHint({ requested, revision }: { requested: boolean; revision: number }) {
  const [quota, setQuota] = useState<PublicQuota | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  useEffect(() => {
    if (!requested) return
    const controller = new AbortController()
    setState(current => current === 'ready' ? current : 'loading')
    getSharedQuota(controller.signal)
      .then(value => { if (!controller.signal.aborted) { setQuota(value); setState('ready') } })
      .catch(() => { if (!controller.signal.aborted) setState('unavailable') })
    return () => controller.abort()
  }, [requested, revision])
  if (state === 'idle') return null
  let text = 'Checking site API availability…'
  if (state === 'unavailable') text = 'Site API availability could not be checked. Open Activity & costs to retry. This does not mean the quota is used up.'
  else if (quota) {
    const minutes = Math.floor(quota.capture.remaining_ms / 60000)
    if (quota.analyses.remaining <= 0 || quota.capture.remaining_ms <= 0) text = 'No shared analyses left today. Browse saved designs while capacity renews. These limits also apply with your own key.'
    else if (!quota.demo_budget_available) text = `${quota.analyses.remaining} of ${quota.analyses.limit} shared analyses left today. The site’s AI allowance is at capacity; you can use your own API key for AI.`
    else text = `${quota.analyses.remaining} of ${quota.analyses.limit} shared analyses left today · ${minutes} min of capture · ${quota.per_ip.hourly_limit} per visitor each hour.`
  }
  return <p className="allowance-hint" role="status" data-state={state}>{text}</p>
}
