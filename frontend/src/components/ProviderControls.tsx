import { useEffect, useRef, useState } from 'react'
import { byokAvailable, getProviders } from '../api'
import { providerNames, type ByokCredentials, type Provider, type ProviderOption } from '../byok'

interface Props {
  busy: boolean
  onChange: (credentials: ByokCredentials | null | undefined) => void
  status?: 'unverified' | 'checking' | 'verified' | 'error'
  statusError?: string
  openRevision?: number
}

export default function ProviderControls({ busy, onChange, status = 'unverified', statusError = '', openRevision = 0 }: Props) {
  const [ownKey, setOwnKey] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [accepted, setAccepted] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keyIssue, setKeyIssue] = useState('')
  const [options, setOptions] = useState<ProviderOption[]>([])
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const keyInput = useRef<HTMLInputElement>(null)
  const secure = byokAvailable()
  const [visibleKey, setVisibleKey] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const openPanel = () => { dialog.current?.showModal() }
  const closePanel = () => { dialog.current?.close(); setVisibleKey(false); trigger.current?.focus() }
  useEffect(() => { if (openRevision) dialog.current?.showModal() }, [openRevision])
  useEffect(() => {
    const closeOnNavigation = () => { dialog.current?.close(); setVisibleKey(false) }
    window.addEventListener('hashchange', closeOnNavigation)
    return () => window.removeEventListener('hashchange', closeOnNavigation)
  }, [])
  const selected = options.find(o => o.provider === provider)

  useEffect(() => {
    if (!showRates && (!ownKey || !secure)) return
    const controller = new AbortController()
    setError('')
    getProviders(controller.signal).then(setOptions).catch(() => {
      if (!controller.signal.aborted) setError('Provider settings could not be loaded.')
    })
    return () => controller.abort()
  }, [ownKey, secure, catalogRevision, showRates])

  useEffect(() => {
    const key = keyInput.current?.value || ''
    onChange(!ownKey ? undefined : secure && selected && accepted && /^[\x21-\x7e]{8,512}$/.test(key)
      ? { provider, key } : null)
  }, [ownKey, provider, accepted, hasKey, secure, selected, onChange, revision])

  useEffect(() => {
    // pagehide also covers back/forward-cache navigation. Clear the DOM and the
    // parent's ref before a page can be restored; never persist a credential.
    const clear = () => {
      if (keyInput.current) keyInput.current.value = ''
      setKeyIssue('')
      setHasKey(false)
      setVisibleKey(false)
      setAccepted(false)
      onChange(ownKey ? null : undefined)
    }
    window.addEventListener('pagehide', clear)
    return () => { window.removeEventListener('pagehide', clear) }
  }, [ownKey, onChange])

  function clearKey() {
    if (keyInput.current) keyInput.current.value = ''
    setKeyIssue('')
    setHasKey(false)
    setVisibleKey(false)
    setAccepted(false)
    onChange(ownKey ? null : undefined)
  }

  const state = !ownKey ? 'off' : error || keyIssue || status === 'error' ? 'error' : !hasKey || !accepted ? 'unverified' : status
  const stateText = state === 'off' ? 'Off' : state === 'verified' ? 'Verified' : state === 'checking' ? 'Checking with analysis…' : state === 'error' ? 'Needs attention' : 'Not verified'
  return (
    <div className="key-access">
      <div className="key-access-row">
        <button ref={trigger} type="button" className="key-trigger" onClick={openPanel}>Use your own key</button>
        <span className={`key-status key-status-${state}`} role="status"><span aria-hidden="true" />{stateText}</span>
      </div>
      <p className="field-help">Your key stays in this tab’s memory. We don’t save it.</p>
      <dialog ref={dialog} className="key-dialog" aria-labelledby="provider-heading" onCancel={e => { e.preventDefault(); closePanel() }}>
      <div className="dialog-heading"><h2 id="provider-heading">Use your own key</h2><button type="button" className="secondary-button" onClick={closePanel} aria-label="Close key settings">Close</button></div>
      <section className="provider-controls">
      <div className="provider-toolbar">
        <div>
          <p className="field-label">Pay for analysis with</p>
          <p className="field-help">{ownKey ? 'Charged to your provider account' : 'Shared allowance · Gemini'}</p>
        </div>
        <fieldset className="provider-choice" disabled={busy}>
          <legend className="sr-only">Who pays for AI</legend>
          <label><input type="radio" name="funding" checked={!ownKey} onChange={() => { clearKey(); setOwnKey(false) }} /> Shared allowance</label>
          <label><input type="radio" name="funding" checked={ownKey} onChange={() => setOwnKey(true)} /> Your own key</label>
        </fieldset>
      </div>
      <details className="provider-rates" onToggle={event => setShowRates(event.currentTarget.open)}>
        <summary>Models & estimated rates</summary>
        <p className="field-help mt-3">Rates are estimates in USD per million tokens. With your own key, your provider bills your account. Missing prices are unavailable, not free.</p>
        {error ? <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => setCatalogRevision(n => n + 1)}>Reload rates</button></p> : options.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Provider rates">
          <table className="consumption-table"><thead><tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Input / 1M</th><th scope="col">Output / 1M</th></tr></thead><tbody>
            {options.map(option => <tr key={option.provider}><th scope="row">{providerNames[option.provider]}</th><td>{option.model}</td><td>{option.inputPrice == null ? 'Unavailable' : `US$${option.inputPrice}`}</td><td>{option.outputPrice == null ? 'Unavailable' : `US$${option.outputPrice}`}</td></tr>)}
          </tbody></table>
        </div> : <p role="status" className="mt-3 text-sm">Loading provider rates…</p>}
        <p className="field-help mt-3">BYOK keeps shared capture and admission limits. Remaining shared capacity is not reported here.</p>
      </details>
      {ownKey && (
        <div className="provider-details">
          {!secure ? <p role="status">Using your own key requires an HTTPS page and API. Use the HTTPS site to enter a key.</p> : <>
            <div className="provider-fields">
              <div className="field-group">
                <label className="field-label" htmlFor="ai-provider">AI provider</label>
                <select id="ai-provider" className="url-input" value={provider} disabled={busy} onChange={e => { clearKey(); setProvider(e.target.value as Provider) }}>
                  {Object.entries(providerNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                </select>
                <p className="field-help">Model: {selected?.model || 'Loading…'}</p>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="provider-key">Provider API key</label>
                <input ref={keyInput} id="provider-key" type={visibleKey ? "text" : "password"} className="url-input" autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={512} disabled={busy} aria-describedby="key-privacy key-error" aria-invalid={Boolean(keyIssue)} onBlur={e => setKeyIssue(e.target.value && !/^[\x21-\x7e]{8,512}$/.test(e.target.value) ? 'Enter a key with 8–512 characters and no spaces.' : '')} onChange={e => { setKeyIssue(''); setHasKey(Boolean(e.target.value)); setRevision(n => n + 1) }} />
                <p id="key-error" role={keyIssue ? "alert" : undefined} className="field-help">{keyIssue}</p>
                <button type="button" className="text-button" disabled={!hasKey} aria-pressed={visibleKey} onClick={() => setVisibleKey(value => !value)}>{visibleKey ? "Hide key" : "Show key"}</button>
                <p id="key-privacy" className="field-help">Kept only in this tab. Cleared when you reload or leave the page.</p>
              </div>
            </div>
            {error && <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => setCatalogRevision(n => n + 1)}>Reload providers</button></p>}
            <p className="provider-notice">Sent over HTTPS through our server to your selected provider. We don’t save your key. Screenshots and page evidence are processed under your provider’s terms.</p>
            <p className="provider-notice">Your key is verified when the provider accepts an analysis. Entering a key does not make a test call.</p>
            {statusError && <p role="alert" className="form-notice">{statusError}</p>}
            <details className="provider-rates"><summary>Usage limits</summary><p className="provider-notice">One AI attempt per analysis. No automatic retries. Limits of 3 attempts/hour and 5/day per IP still apply, along with shared daily capture and concurrency limits. Stopping waiting does not guarantee remote work has stopped.</p></details>
            <p className="provider-notice">{selected?.inputPrice != null && selected.outputPrice != null
              ? `Estimated token pricing: US$${selected.inputPrice} input / US$${selected.outputPrice} output per million tokens. Always estimated.`
              : 'Cost estimate unavailable for this model. Check pricing with your provider before running an analysis.'}</p>
            <div className="provider-confirm">
              <label><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /> I understand and accept my provider’s charges and terms.</label>
              <button type="button" className="secondary-button" disabled={busy || !hasKey} onClick={clearKey}>Clear key</button>
            </div>
          </>}
        </div>
      )}
    </section>
    <button type="button" className="action-button dialog-done" onClick={closePanel}>Done</button>
    </dialog>
    </div>
  )
}
