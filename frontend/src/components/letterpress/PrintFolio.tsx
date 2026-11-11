import '../blueprint-steps.css'
import { useRef } from 'react'
import WorkshopDrawing, { useWorkshopPlayback } from './WorkshopDrawing'

const steps = [
  { number: 1, title: 'Strike the letter', description: 'Start with a website URL.' },
  { number: 2, title: 'Read the proof', description: 'Inspect its type, colors and spacing.' },
  { number: 3, title: 'Sort the sheets', description: 'Export the design in five formats.' },
] as const

export default function PrintFolio() {
  const host = useRef<HTMLElement>(null)
  useWorkshopPlayback(host)

  return (
    <section ref={host} data-study="print" className="proof-press print-folio" aria-label="Analysis steps">
      <div className="folio-inner">
        <h2>From page to proof.</h2>
        <ol className="folio-steps" role="list">
          {steps.map(({ number, title, description }) => (
            <li key={number}>
              <span className="folio-number" aria-hidden="true">{number}</span>
              <WorkshopDrawing step={number} />
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
