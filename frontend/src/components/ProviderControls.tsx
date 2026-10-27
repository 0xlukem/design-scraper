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
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [accepted, setAccepted] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keyIssue, setKeyIssue] = useState('')
  const [options, setOptions] = useState<ProviderOption[]>([])
  const [error, setError] = useState('')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [visibleKey, setVisibleKey] = useState(false)
  const [keyCleared, setKeyCleared] = useState(false)
  const activeKey = useRef<ByokCredentials | null>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const providerInput = useRef<HTMLSelectElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const secure = byokAvailable()
  const selected = options.find(option => option.provider === provider)

  const closePanel = () => {
    if (keyInput.current) keyInput.current.value = ''
    setOpen(false); setVisibleKey(false); setKeyIssue('')
    trigger.current?.focus()
  }
  function openPanel() {
    setProvider(activeKey.current?.provider || 'gemini')
    setAccepted(Boolean(activeKey.current)); setHasKey(Boolean(activeKey.current))
    setKeyIssue(''); setVisibleKey(false); setOpen(true)
  }
  useEffect(() => { if (openRevision) openPanel() }, [openRevision])
  useEffect(() => {
    if (!open) return
    if (keyInput.current) keyInput.current.value = activeKey.current?.key || ''
    providerInput.current?.focus()
  }, [open])
  useEffect(() => {
    const closeOnNavigation = () => {
      if (keyInput.current) keyInput.current.value = ''
      setOpen(false); setVisibleKey(false)
    }
    window.addEventListener('hashchange', closeOnNavigation)
    return () => window.removeEventListener('hashchange', closeOnNavigation)
  }, [])
  useEffect(() => {
    if (!open || !secure) return
    const controller = new AbortController()
    setError('')
    getProviders(controller.signal).then(value => {
      if (!controller.signal.aborted) setOptions(value)
    }).catch(() => { if (!controller.signal.aborted) setError('Provider settings could not be loaded.') })
    return () => controller.abort()
  }, [open, secure, catalogRevision])
  useEffect(() => {
    const clear = () => {
      activeKey.current = null
      if (keyInput.current) keyInput.current.value = ''
      setHasKey(false); setAccepted(false); setVisibleKey(false); setKeyCleared(ownKey)
      onChange(ownKey ? null : undefined)
    }
    window.addEventListener('pagehide', clear)
    return () => window.removeEventListener('pagehide', clear)
  }, [ownKey, onChange])

  function clearDraft() {
    if (keyInput.current) keyInput.current.value = ''
    setHasKey(false); setAccepted(false); setKeyIssue('')
  }
  function clearKey() {
    activeKey.current = null; clearDraft(); setKeyCleared(ownKey)
    onChange(ownKey ? null : undefined)
  }
  function useDesignScraper() {
    activeKey.current = null; clearDraft(); setOwnKey(false); setKeyCleared(false)
    onChange(undefined); closePanel()
  }
  function applyKey() {
    const key = keyInput.current?.value || ''
    if (busy || !secure || !selected || !accepted || !/^[\x21-\x7e]{8,512}$/.test(key)) return
    const credentials = { provider, key }
    activeKey.current = credentials; setOwnKey(true); setKeyCleared(false)
    onChange(credentials); closePanel()
  }
  const state = !ownKey ? 'included' : keyCleared ? 'unverified' : status
  const stateText = !ownKey ? 'Using Design Scraper · Included' : keyCleared ? 'Key cleared' : state === 'verified' ? 'Verified' : state === 'checking' ? 'Checking with analysis…' : state === 'error' ? 'Needs attention' : 'Ready for next analysis'
  return <div className="key-access">
    <div className="key-access-row">
      <span className={`key-status key-status-${state}`} role="status"><span aria-hidden="true" />{ownKey && `${providerNames[activeKey.current?.provider || provider]} · Your API key · `}{stateText}</span>
      <button ref={trigger} type="button" className="key-trigger" disabled={busy} aria-expanded={open} aria-controls="provider-settings" onClick={openPanel}>{ownKey ? 'Manage key' : 'Use my API key'}</button>
      {ownKey && !open && <button type="button" className="text-button" disabled={busy} onClick={useDesignScraper}>Use Design Scraper</button>}
    </div>
    {ownKey && statusError && !open && <p role="alert" className="field-help">{statusError}</p>}
    {open && <section id="provider-settings" className="key-inline" aria-labelledby="provider-heading" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closePanel() } }}>
      <div className="dialog-heading"><h2 id="provider-heading">{ownKey ? 'Edit your API key' : 'Use your API key'}</h2></div>
      {!secure ? <p role="status">Using your own key requires an HTTPS page and API. Use the HTTPS site to enter a key.</p> : <>
        <div className="provider-fields">
          <div className="field-group">
            <label className="field-label" htmlFor="ai-provider">AI provider</label>
            <select ref={providerInput} id="ai-provider" className="url-input" value={provider} disabled={busy} onChange={event => { clearDraft(); setProvider(event.target.value as Provider) }}>
              {Object.entries(providerNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <p className="field-help">Model: {selected?.model || (error ? 'Unavailable' : 'Loading…')}</p>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="provider-key">Provider API key</label>
            <input ref={keyInput} id="provider-key" type={visibleKey ? 'text' : 'password'} className="url-input" autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={512} disabled={busy} aria-describedby="key-privacy key-error" aria-invalid={Boolean(keyIssue)} onChange={event => { const valid = /^[\x21-\x7e]{8,512}$/.test(event.target.value); setHasKey(valid); setKeyIssue(event.target.value && !valid ? 'Enter a key with 8–512 characters and no spaces.' : '') }} />
            <p id="key-error" role={keyIssue ? 'alert' : undefined} className="field-help">{keyIssue}</p>
            <button type="button" className="text-button" disabled={!hasKey} aria-pressed={visibleKey} onClick={() => setVisibleKey(value => !value)}>{visibleKey ? 'Hide key' : 'Show key'}</button>
          </div>
        </div>
        {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => setCatalogRevision(n => n + 1)}>Reload providers</button></p>}
        <p id="key-privacy" className="provider-notice">Kept in this tab until reload or exit. Sent over HTTPS through Design Scraper to your provider only when you analyze. We don’t save it.</p>
        <p className="field-help">{selected?.inputPrice != null && selected.outputPrice != null ? `Estimated rates: US$${selected.inputPrice} input / US$${selected.outputPrice} output per million tokens.` : 'Estimated rates unavailable. Check your provider’s pricing.'}</p>
        {statusError && <p role="alert" className="form-notice">{statusError}</p>}
        <details className="provider-rates"><summary>Usage & key removal</summary><p className="provider-notice">Your key is checked with your next analysis. Site analysis and capture limits still apply. No automatic retries. Stopping waiting may not stop remote work or consumption.</p>{ownKey && <div className="key-removal"><p>Remove this key from the tab. Analysis stays paused until you add a key or choose Design Scraper.</p><button type="button" className="text-button" disabled={busy || !activeKey.current && !hasKey} onClick={clearKey}>Clear key</button></div>}</details>
        <label className="provider-consent"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /> I understand and accept my provider’s charges and terms.</label>
        <div className="provider-actions"><button type="button" className="action-button" disabled={busy || !hasKey || !accepted || !selected || Boolean(error)} onClick={applyKey}>Save key</button><button type="button" className="text-button" onClick={closePanel}>Cancel</button></div>
      </>}
      {!secure && <button type="button" className="text-button" onClick={closePanel}>Close key settings</button>}
    </section>}
  </div>
}
