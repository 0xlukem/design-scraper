import { Lightning } from '@phosphor-icons/react'
import type { FormEvent } from 'react'
import type { MixBias } from '../types'
import BlendSlider from './BlendSlider'
import MagneticButton from './MagneticButton'
import UrlSuggestions, { type UrlSuggestion } from './UrlSuggestions'

interface MixFormProps {
  url1: string
  url2: string
  bias: MixBias
  loading: boolean
  disabled?: boolean
  suggestions?: UrlSuggestion[]
  onUrlChange: (field: 'url1' | 'url2', value: string) => void
  onIntent?: () => void
  onBiasChange: (value: MixBias) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function MixForm({
  url1,
  url2,
  bias,
  loading,
  disabled = false,
  suggestions = [],
  onUrlChange,
  onIntent,
  onBiasChange,
  onSubmit,
  onCancel,
}: MixFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled && !loading && url1.trim() && url2.trim()) onSubmit()
  }

  return (
    <form onSubmit={submit} className="mix-form">
      <div className="grid gap-4">
        <div className="field-group mix-source mix-source-one">
          <label htmlFor="mix-url-1" className="field-label">
            First website URL
          </label>
          <input
            id="mix-url-1"
            type="url"
            required
            autoComplete="url"
            value={url1}
            disabled={loading}
            onFocus={onIntent}
            onChange={(event) => onUrlChange('url1', event.target.value)}
            placeholder="https://first-reference.com"
            className="url-input"
          />
          <p className="field-help">The left side of the blend.</p>
        </div>
        <div className="field-group mix-source mix-source-two">
          <label htmlFor="mix-url-2" className="field-label">
            Second website URL
          </label>
          <input
            id="mix-url-2"
            type="url"
            required
            autoComplete="url"
            value={url2}
            disabled={loading}
            onFocus={onIntent}
            onChange={(event) => onUrlChange('url2', event.target.value)}
            placeholder="https://second-reference.com"
            className="url-input"
          />
          <p className="field-help">The right side of the blend.</p>
        </div>
      </div>
      <UrlSuggestions suggestions={suggestions} disabled={loading} onPick={suggestion => {
        onUrlChange('url1', suggestion.urls[0])
        onUrlChange('url2', suggestion.urls[1])
        onIntent?.()
        document.getElementById('mix-url-1')?.focus()
      }} />
      <BlendSlider value={bias} onChange={onBiasChange} disabled={loading} />
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <MagneticButton
          type="submit"
          tone="acid"
          disabled={disabled || loading || !url1.trim() || !url2.trim()}
          className="min-w-56"
        >
          <Lightning size={19} weight="fill" aria-hidden="true" />
          {loading ? 'Mixing sources' : 'Mix designs'}
        </MagneticButton>
        {loading && (
          <button type="button" onClick={onCancel} className="secondary-button">
            Stop waiting
          </button>
        )}
      </div>
    </form>
  )
}
