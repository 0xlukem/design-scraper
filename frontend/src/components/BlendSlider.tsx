import type { MixBias } from '../types'
import { BIAS_WEIGHTS } from '../types'

interface BlendSliderProps {
  value: MixBias
  onChange: (value: MixBias) => void
  disabled?: boolean
}

const stops: MixBias[] = [-50, -25, 0, 25, 50]

export default function BlendSlider({
  value,
  onChange,
  disabled,
}: BlendSliderProps) {
  const [web1, web2] = BIAS_WEIGHTS[value]
  return (
    <div className="blend-control">
      <div className="flex items-end justify-between gap-4">
        <div>
          <label htmlFor="mix-bias" className="field-label">
            Mix balance
          </label>
          <p className="field-help">Choose how much each website contributes.</p>
        </div>
        <output
          htmlFor="mix-bias"
          className="border-2 border-[var(--ink)] bg-[var(--paper)] px-3 py-2 font-mono text-sm font-bold"
          aria-live="polite"
        >
          {web1}% / {web2}%
        </output>
      </div>
      <input
        id="mix-bias"
        type="range"
        min="-50"
        max="50"
        step="25"
        value={value}
        disabled={disabled}
        aria-valuetext={`Web 1 ${web1} percent, Web 2 ${web2} percent`}
        onChange={(event) => onChange(Number(event.target.value) as MixBias)}
        className="blend-slider"
        list="blend-stops"
      />
      <datalist id="blend-stops">
        {stops.map((stop) => (
          <option key={stop} value={stop} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 border-2 border-[var(--ink)] font-mono text-sm font-bold uppercase">
        <div className="bg-[var(--coral)] p-3">
          Web #1 <span className="float-right">{web1}%</span>
        </div>
        <div className="border-l-2 border-[var(--ink)] bg-[var(--cyan)] p-3">
          Web #2 <span className="float-right">{web2}%</span>
        </div>
      </div>
    </div>
  )
}
