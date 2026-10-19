import type { AnalysisProgress } from '../types'
import { CircleNotch, Scan, Sparkle, FileMd } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

// Spinner pattern from shadcn/ui, using the project's existing Phosphor icon set.
export default function LoadingSkeleton({ isMix, startedAt, progress }: { isMix: boolean; startedAt?: number; progress?: AnalysisProgress }) {
  const [start] = useState(() => startedAt || Date.now())
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - start) / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [start])
  const labels = { admitted: 'Request admitted', capture: `Capturing ${progress?.source?.replace('_', ' ') || 'website'}`, counting_tokens: 'Checking input tokens', analyzing: 'Generating the design system', exporting: 'Validating and preparing exports', complete: 'Result ready', failed: 'Analysis interrupted' }
  return <section className={`result-shell loading-lab ${isMix ? 'result-shell-wild' : ''}`} aria-busy="true">
    <div className="loading-paint" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <CircleNotch className="animate-spin motion-reduce:animate-none" size={32} aria-hidden="true" />
        <div><span className="section-kicker">A new direction is taking shape</span><h2 className="mt-2 text-2xl font-semibold">Analyzing design</h2></div>
      </div>
      <span className="font-mono text-sm tabular-nums" aria-label="Elapsed time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</span>
    </div>
    <progress className="analysis-progress" max={100} value={progress?.percent} aria-label={progress ? "Completed analysis steps" : "Analysis in progress; percentage unavailable"} />
    <p role="status" className="text-sm leading-relaxed">{progress ? `${labels[progress.stage]} · ${progress.percent}% of steps complete` : 'Request sent. Waiting for the capture and AI result.'}</p>
    <p className="mt-2 text-xs text-[var(--muted)]">{progress ? `${progress.completed_steps} / ${progress.total_steps} steps confirmed by the server. Steps take different amounts of time; this is not a time estimate.` : 'Waiting for live progress. Older servers may only return a final result.'}</p>
    {elapsed >= 60 && <p role="status" className="mt-3 text-sm">Still waiting. Resource-heavy pages and AI processing can take longer. You can stop waiting above.</p>}

    <ol className="process-steps">
      <li><Scan size={24} aria-hidden="true" /><strong>Capture evidence</strong><span>{isMix ? 'Capture each active source in your blend.' : 'Load the public page, styles, fonts and images.'} Video playback is excluded.</span></li>
      <li><Sparkle size={24} aria-hidden="true" /><strong>Analyze with AI</strong><span>Your selected provider interprets screenshots and CSS evidence.</span></li>
      <li><FileMd size={24} aria-hidden="true" /><strong>Prepare five exports</strong><span>Validate one system, then prepare Markdown, CSS and tokens.</span></li>
    </ol>
    <p className="text-xs leading-relaxed text-[var(--muted)]">Stopping waiting does not cancel remote work; remote work may still consume quota. Reload clears your BYOK key and does not start another analysis.</p>
  </section>
}
