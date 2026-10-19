import type { KeyboardEvent } from 'react'
import type { AppMode } from '../types'
import { Scan, Intersect } from '@phosphor-icons/react'

interface ModeToggleProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

const tabs: Array<{ mode: AppMode; label: string }> = [
  { mode: 'single', label: 'Extract design' },
  { mode: 'mix', label: 'Mix It' },
]

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextMode = event.key === 'Home' ? 'single' : event.key === 'End' ? 'mix' : mode === 'single' ? 'mix' : 'single'
    onChange(nextMode)
    document.getElementById(`mode-${nextMode}`)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Analysis mode"
      onKeyDown={onKeyDown}
      className="mode-toggle"
    >
      {tabs.map((tab) => {
        const selected = tab.mode === mode
        return (
          <button
            key={tab.mode}
            id={`mode-${tab.mode}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="analysis-form"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.mode)}
            className="mode-tab"
          >
            {selected && <span className="mode-tab-active" aria-hidden="true" />}
            <span className="mode-label">{tab.mode === 'single' ? <Scan size={18} aria-hidden="true" /> : <Intersect size={19} aria-hidden="true" />}{tab.label}</span>

          </button>
        )
      })}
    </div>
  )
}
