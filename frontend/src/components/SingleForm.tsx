import type { FormEvent } from 'react'
import UrlSuggestions, { type UrlSuggestion } from './UrlSuggestions'

interface SingleFormProps {
  url: string
  loading: boolean
  disabled?: boolean
  suggestions?: UrlSuggestion[]
  onUrlChange: (value: string) => void
  onIntent?: () => void
  onSubmit: () => void
}

export default function SingleForm({
  url,
  loading,
  disabled = false,
  suggestions = [],
  onUrlChange,
  onIntent,
  onSubmit,
}: SingleFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled && !loading && url.trim()) onSubmit()
  }

  return (
    <form id="website-references" onSubmit={submit} className="sober-form">
      <div className="field-group">
        <div className="url-label-row">
          <label htmlFor="single-url" className="field-label">Website URL</label>
          <p id="single-url-help" className="field-help">Enter a public website URL.</p>
        </div>
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
          placeholder="https://example.com"
          className="url-input"
        />
        <UrlSuggestions suggestions={suggestions} disabled={loading} onPick={suggestion => {
          onUrlChange(suggestion.urls[0])
          onIntent?.()
          document.getElementById('single-url')?.focus()
        }} />
      </div>
    </form>
  )
}
