import { Fragment, useId, useLayoutEffect, type RefObject } from 'react'
import { playWhileVisible } from '../visible-playback'
import views from './workshop-views.json'

type Step = 1 | 2 | 3
const fanAngles = [-48, -32, -16, 0]
const shelfNumbers = [0, 1, 2, 3, 4]
const sheetTravel = views[2].sheetTravel!
const punchTravel = views[0].strokeTravel!

function Plate({ name }: { name: string }) {
  return <use href={`/images/workshop-plates.svg#${name}`} />
}

function PunchAndMatrix() {
  return <>
    <Plate name="matrix-block" />
    <g data-motion-part="imprint"><Plate name="matrix-letter" /></g>
    <g data-motion-part="punch" transform={`translate(0 ${-punchTravel})`}><Plate name="hand-punch" /></g>
  </>
}

function ProofingTable() {
  return <>
    <Plate name="proof-table" />
    <g transform={views[1].fan}>
      {fanAngles.map((angle,i) => <g key={i} data-motion-part="swatch" transform={`rotate(${angle} 3.3 .8)`}>
        <Plate name={`swatch-${i}`} />
      </g>)}
    </g>
    <g transform={views[1].rule}><g data-motion-part="typometer"><Plate name="type-rule" /></g></g>
  </>
}

function DispatchCabinet() {
  return <>
    <Plate name="dispatch-back" />
    {shelfNumbers.map(i => <Fragment key={i}>
      <Plate name={`shelf-${i}`} />
      <g data-motion-part="sheet"><Plate name={`sheet-${i}`} /></g>
      <Plate name={`tag-${i}`} />
    </Fragment>)}
    <Plate name="dispatch-casing" />
  </>
}

export default function WorkshopDrawing({ step }: { step: Step }) {
  const id = useId().replace(/:/g,'')
  const view = views[step-1].box
  const [x,y,width,height] = view.split(' ').map(Number)
  return <svg viewBox={view} data-workshop={step} aria-hidden="true" focusable="false">
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height}>
        {step === 1 ? <PunchAndMatrix /> : step === 2 ? <ProofingTable /> : <DispatchCabinet />}
      </mask>
    </defs>
    <rect x={x} y={y} width={width} height={height} fill="currentColor" mask={`url(#${id})`} />
  </svg>
}

function ease(progress: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (progress-start)/(end-start)))
  return t*t*(3-2*t)
}

export function useWorkshopPlayback(host: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const root = host.current
    if (!root) return
    const punch = root.querySelector('[data-motion-part="punch"]')!
    const imprint = root.querySelector('[data-motion-part="imprint"]')!
    const swatches = root.querySelectorAll('[data-motion-part="swatch"]')
    const ruler = root.querySelector('[data-motion-part="typometer"]')!
    const sheets = root.querySelectorAll('[data-motion-part="sheet"]')
    // One physical operation per beat. Keep parked parts at their final
    // position while the reader follows the next operation across the row.
    const playback = playWhileVisible(root, 7800, progress => {
      const blow = ease(progress,.045,.14) - ease(progress,.17,.29)
      punch.setAttribute('transform', `translate(0 ${(-punchTravel*(1-blow)).toFixed(2)})`)
      imprint.setAttribute('opacity', progress < .14 ? '0' : '1')

      const fan = ease(progress,.30,.47)
      swatches.forEach((card,i) => card.setAttribute('transform', `rotate(${(fan*fanAngles[i]).toFixed(2)} 3.3 .8)`))
      const measure = ease(progress,.42,.60)
      ruler.setAttribute('transform', `translate(0 ${(13*(1-measure)).toFixed(2)})`)

      sheets.forEach((sheet,i) => {
        const start = .605 + i*.072
        const feed = ease(progress,start,start+.085)
        sheet.setAttribute('opacity', ease(progress,start,start+.018).toFixed(2))
        sheet.setAttribute('transform', `translate(${((1-feed)*sheetTravel[0]).toFixed(2)} ${((1-feed)*sheetTravel[1]).toFixed(2)})`)
      })
    })
    return playback.dispose
  }, [host])
}
