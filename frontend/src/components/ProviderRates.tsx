import { useEffect, useState } from 'react'
import { getProviders } from '../api'
import { providerNames, type ProviderOption } from '../byok'

export default function ProviderRates({ active }: { active: boolean }) {
  const [options, setOptions] = useState<ProviderOption[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true); setError('')
    getProviders(controller.signal).then(value => {
      if (!controller.signal.aborted) setOptions(value)
    }).catch(() => { if (!controller.signal.aborted) setError('Models and rates could not be updated. Try again.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, revision])
  return <section className="model-catalog" aria-labelledby="models-title">
    <div className="activity-section-heading"><h2 id="models-title">Model rates</h2><span>Estimated USD / 1M tokens</span></div>
    {error && <p role="alert">{error}{options.length > 0 && ' Showing the last successfully loaded rates.'}</p>}
    {loading && <p role="status">Loading provider rates…</p>}
    {options.length > 0 && <div role="region" aria-label="Provider rates" aria-busy={loading}>
      <table className="model-rates-table"><caption className="sr-only">Configured models and estimated processing rates</caption><thead><tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Input / 1M</th><th scope="col">Output / 1M</th></tr></thead><tbody>{options.map(option => <tr key={option.provider}>
        <th scope="row">{providerNames[option.provider]}<small>{option.provider === 'gemini' ? 'Included with Design Scraper' : 'Your API key'}</small></th><td data-label="Model">{option.model}</td><td data-label="Input / 1M">{option.inputPrice == null ? 'Unavailable' : `US$${option.inputPrice}`}</td><td data-label="Output / 1M">{option.outputPrice == null ? 'Unavailable' : `US$${option.outputPrice}`}</td>
      </tr>)}</tbody></table>
    </div>}
    <div className="models-foot"><p>Gemini is included with Design Scraper. With your own key, your provider’s rates apply. Unavailable rates do not mean free usage.</p><button type="button" className="text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>{error ? 'Reload model rates' : 'Refresh rates'}</button></div>
  </section>
}
