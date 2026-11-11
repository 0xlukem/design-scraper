import type { AnalysisProgress } from '../types'
import { CircleNotch } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

const isLocalDemo = import.meta.env.DEV && import.meta.env.MODE === 'demo'

// Spinner pattern from shadcn/ui, using the project's existing Phosphor icon set.
export default function LoadingSkeleton({ isMix, startedAt, progress, onCancel }: { isMix: boolean; startedAt?: number; progress?: AnalysisProgress; onCancel?: () => void }) {
  const [start] = useState(() => startedAt || Date.now())
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - start) / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [start])
  const labels = { admitted: 'Request admitted', capture: isMix ? `Capturing the ${progress?.source === 'web_2' ? 'second' : 'first'} website` : 'Capturing the website', counting_tokens: 'Checking input tokens', analyzing: 'Generating the design system', exporting: 'Validating and preparing exports', complete: 'Result ready', failed: 'Analysis interrupted' }
  return <section className={`result-shell loading-lab ${isMix ? 'result-shell-wild' : ''}`} aria-label="Analysis progress">
    <div className="loading-paint" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <CircleNotch className="animate-spin motion-reduce:animate-none" size={32} aria-hidden="true" />
        <h2 className="text-2xl font-semibold">Analyzing design</h2>
      </div>
      <span className="font-mono text-sm tabular-nums" aria-label="Elapsed time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</span>
    </div>
    <progress className="analysis-progress" max={100} value={progress?.percent} aria-label={progress ? "Completed analysis steps" : "Analysis in progress; percentage unavailable"} />
    <p role="status" className="text-sm leading-relaxed">{progress
      ? `${labels[progress.stage]} · ${progress.completed_steps} of ${progress.total_steps} steps (${progress.percent}%)`
      : 'Request sent. Waiting for progress…'}</p>
    {elapsed >= 60 && <p role="status" className="mt-3 text-sm">This is taking longer than usual.</p>}
    <div className="loading-actions">
      {onCancel && <button type="button" onClick={onCancel} className="secondary-button">Stop waiting</button>}
      <p className="text-xs leading-relaxed text-[var(--muted)]">{isLocalDemo
        ? 'This simulation uses a saved result.'
        : 'If you stop waiting, the analysis may continue to use quota.'}</p>
    </div>
  </section>
}
