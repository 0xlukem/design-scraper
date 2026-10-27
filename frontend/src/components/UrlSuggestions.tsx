import type { MixBias } from '../types'
export interface UrlSuggestion {
  id: string
  label: string
  urls: string[]
  bias?: MixBias
}

/** Prefills a form with URLs from saved designs. It never submits an analysis. */
export default function UrlSuggestions({ suggestions, disabled = false, onPick }: { suggestions: UrlSuggestion[]; disabled?: boolean; onPick: (suggestion: UrlSuggestion) => void }) {
  if (!suggestions.length) return null
  return <div className="url-suggestions" role="group" aria-label="Try a reference">
    <span className="url-suggestions-label">Try</span>
    {suggestions.map(suggestion => <button key={suggestion.id} type="button" className="url-chip" disabled={disabled} onClick={() => onPick(suggestion)}>{suggestion.label}</button>)}
  </div>
}
