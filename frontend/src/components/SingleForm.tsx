import { ArrowRight } from '@phosphor-icons/react'
import type { FormEvent } from 'react'
import MagneticButton from './MagneticButton'
import UrlSuggestions, { type UrlSuggestion } from './UrlSuggestions'

interface SingleFormProps {
  url: string
  loading: boolean
  disabled?: boolean
  suggestions?: UrlSuggestion[]
  onUrlChange: (value: string) => void
  onIntent?: () => void
  onSubmit: () => void
  onCancel: () => void
}

export default function SingleForm({
  url,
  loading,
  disabled = false,
  suggestions = [],
  onUrlChange,
  onIntent,
  onSubmit,
  onCancel,
}: SingleFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled && !loading && url.trim()) onSubmit()
  }

  return (
    <form onSubmit={submit} className="sober-form">
      <div className="field-group">
        <label htmlFor="single-url" className="field-label">
          Website URL
        </label>
        <input
          id="single-url"
          type="url"
          aria-describedby="single-url-help"
          required
          autoComplete="url"
          value={url}
          disabled={loading}
          onFocus={onIntent}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://your-reference.com"
          className="url-input"
        />
        <p id="single-url-help" className="field-help">
          Enter a public website URL.
        </p>
        <UrlSuggestions suggestions={suggestions} disabled={loading} onPick={suggestion => {
          onUrlChange(suggestion.urls[0])
          onIntent?.()
          document.getElementById('single-url')?.focus()
        }} />
      </div>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <MagneticButton
          type="submit"
          tone="accent"
          disabled={disabled || loading || !url.trim()}
          className="min-w-52"
        >
          {loading ? 'Analyzing…' : 'Analyze design'}
          <ArrowRight size={19} weight="bold" aria-hidden="true" />
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
