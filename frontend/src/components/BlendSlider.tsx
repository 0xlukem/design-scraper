import type { MixBias } from '../types'
import { BIAS_WEIGHTS } from '../types'
import './mix-form.css'
interface Props {
  value: MixBias
  onChange: (value: MixBias) => void
  disabled?: boolean
  urls?: [string, string]
}
export function sourceName(url: string, fallback: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') || fallback } catch { return fallback }
}
export default function BlendSlider({ value, onChange, disabled, urls = ['', ''] }: Props) {
  const [first, second] = BIAS_WEIGHTS[value]
  const names = [sourceName(urls[0], 'First website'), sourceName(urls[1], 'Second website')]
  return <div className="blend-control">
    <label htmlFor="mix-bias" className="field-label">Mix balance</label>
    <output htmlFor="mix-bias" className="blend-labels" aria-live="polite">
      <span><span>{names[0]}</span><strong>{first}%</strong></span>
      <span><span>{names[1]}</span><strong>{second}%</strong></span>
    </output>
    <div className="blend-proportion" aria-hidden="true"><span style={{ width: `${first}%` }} /><span style={{ width: `${second}%` }} /></div>
    <input id="mix-bias" type="range" min="-50" max="50" step="25" value={value} disabled={disabled}
      aria-valuetext={`${names[0]} ${first} percent, ${names[1]} ${second} percent`}
      onChange={event => onChange(Number(event.target.value) as MixBias)} className="blend-slider" list="blend-stops" />
    <datalist id="blend-stops">{[-50, -25, 0, 25, 50].map(stop => <option key={stop} value={stop} />)}</datalist>
    {(first === 0 || second === 0) && <p className="field-help">Only {first === 0 ? names[1] : names[0]} will be analyzed. This produces a single-source design.</p>}
  </div>
}
