import { useMemo } from 'react'
import type { AppMode } from '../types'
import ScrollStudy from './ScrollStudy'
import './blueprint-steps.css'

export default function AnalysisSteps({ mode }: { mode: AppMode }) {
  const labels = useMemo(() => mode === 'mix'
    ? ['Add two URLs', 'Set the balance', 'Export your mix']
    : ['Add a URL', 'Inspect the design', 'Export your files'], [mode])
  const load = useMemo(() => async () => {
    const { createProofPress } = await import('./proof-press.js')
    return { create: (host: HTMLDivElement, canvas: HTMLCanvasElement) => createProofPress(host, canvas, labels, mode) }
  }, [labels, mode])
  const heading = mode === 'mix' ? 'Mixing steps' : 'Analysis steps'
  return <section className="proof-press" aria-label={heading}>
    <ScrollStudy kind="print" className="proof-study" durationMs={6800} load={load} fallback={
      <picture className="proof-poster">
        <source media="(max-aspect-ratio: 29/50)" srcSet={`/images/workspace/press-${mode}-tall.webp`} />
        <source media="(max-aspect-ratio: 1/1)" srcSet={`/images/workspace/press-${mode}-narrow.webp`} />
        <img src={`/images/workspace/press-${mode}-wide.webp`} alt="" decoding="async" loading="lazy" />
      </picture>
    } />
    <ol className="sr-only" aria-label={heading}>
      {labels.map(label => <li key={label}>{label}</li>)}
    </ol>
  </section>
}
