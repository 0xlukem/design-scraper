import type { FormEvent } from 'react'
import { BIAS_WEIGHTS, type MixBias } from '../types'
import BlendSlider from './BlendSlider'
import UrlSuggestions, { type UrlSuggestion } from './UrlSuggestions'

interface MixFormProps {
  url1: string
  url2: string
  bias: MixBias
  loading: boolean
  disabled?: boolean
  duplicate: boolean
  suggestions?: UrlSuggestion[]
  onUrlChange: (field: 'url1' | 'url2', value: string) => void
  onIntent?: () => void
  onBiasChange: (value: MixBias) => void
  onSubmit: () => void
}

export default function MixForm({
  url1,
  url2,
  bias,
  loading,
  disabled = false,
  duplicate,
  suggestions = [],
  onUrlChange,
  onIntent,
  onBiasChange,
  onSubmit,
}: MixFormProps) {
  const [first, second] = BIAS_WEIGHTS[bias]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled && !loading) onSubmit()
  }

  return (
    <form id="website-references" onSubmit={submit} className="mix-form">
      <div className="grid gap-4">
        <div className="field-group mix-source mix-source-one" data-excluded={first === 0}>
          <label htmlFor="mix-url-1" className="field-label">
            First website URL {first === 0 && <span className="source-excluded" aria-hidden="true">Not included</span>}
          </label>
          <input
            id="mix-url-1"
            type="url"
            required={first > 0}
            autoComplete="url"
            value={url1}
            disabled={loading || first === 0}
            aria-label="First website URL"
            onFocus={onIntent}
            onChange={(event) => onUrlChange('url1', event.target.value)}
            placeholder="https://first-reference.com"
            className="url-input"
          />
        </div>
        <div className="field-group mix-source mix-source-two" data-excluded={second === 0}>
          <label htmlFor="mix-url-2" className="field-label">
            Second website URL {second === 0 && <span className="source-excluded" aria-hidden="true">Not included</span>}
          </label>
          <input
            id="mix-url-2"
            type="url"
            required={second > 0}
            autoComplete="url"
            value={url2}
            disabled={loading || second === 0}
            aria-label="Second website URL"
            onFocus={onIntent}
            onChange={(event) => onUrlChange('url2', event.target.value)}
            placeholder="https://second-reference.com"
            className="url-input"
          />
        </div>
      </div>
      <UrlSuggestions suggestions={suggestions} disabled={loading} onPick={suggestion => {
        onUrlChange('url1', suggestion.urls[0])
        onUrlChange('url2', suggestion.urls[1])
        onBiasChange(suggestion.bias ?? 0)
        onIntent?.()
        requestAnimationFrame(() => document.getElementById(suggestion.bias === 50 ? 'mix-url-2' : 'mix-url-1')?.focus())
      }} />
      <BlendSlider urls={[url1, url2]} value={bias} onChange={onBiasChange} disabled={loading} />
      {duplicate && <p className="mix-duplicate" role="alert">Choose two different URLs to mix designs.</p>}
    </form>
  )
}
