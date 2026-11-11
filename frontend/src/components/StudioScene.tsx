import { memo, useId, useLayoutEffect, useRef } from 'react'
import { playWhileVisible } from './visible-playback'
import { createDraftingRenderer, type LineData } from './letterpress/adana-live.mjs'
import { durationMs, studyFrame, viewBox } from './letterpress/adana-playback.mjs'

const assets = '/images/adana/'
let lineData: Promise<LineData> | undefined
function loadDrawing() {
  lineData ??= fetch(assets + 'lines.json').then(response => {
    if (!response.ok) throw new Error('Could not load the press drawing')
    return response.json() as Promise<LineData>
  }).catch(error => {
    lineData = undefined
    throw error
  })
  return lineData
}

function StudioScene() {
  const host = useRef<HTMLElement>(null)
  const title = useId()
  const description = useId()
  const markId = useId()
  useLayoutEffect(() => {
    const root = host.current!
    const svg = root.querySelector('svg')!
    const fallback = root.querySelector<SVGUseElement>('[data-plate]')!
    const strokes = [...root.querySelectorAll<SVGPathElement>('[data-stroke]')]
    const live = root.querySelector<SVGGElement>('[data-live]')!
    const mark = root.querySelector<SVGUseElement>('[data-mark]')!
    const ink = root.querySelector<SVGGElement>('[data-motion="impression"]')!
    const leaders = root.querySelector<SVGGElement>('[data-leaders]')!
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    let loading = false
    let render: ReturnType<typeof createDraftingRenderer> | undefined
    let lastPose = ''
    function paint(progress: number) {
      const frame = studyFrame(progress)
      const still = preference.matches || !render
      const key = [still, frame.family, frame.value, frame.ink, frame.phase].join(':')
      if (lastPose === key) return
      lastPose = key
      let platen = 64, handle = 38
      if (still) {
        const file = progress === 1 ? 'proof' : 'registered'
        fallback.setAttribute('href', assets + file + '.svg#plate')
        fallback.setAttribute('display', 'inline')
        live.setAttribute('display','none')
        mark.setAttribute('href', assets + file + '.svg#mark')
      } else {
        const pose = render!(frame)
        pose.paths.forEach((d, i) => strokes[i].setAttribute('d',d))
        platen = pose.platen
        handle = pose.handle
        fallback.setAttribute('display','none')
        live.setAttribute('display','inline')
        mark.setAttribute('href','#' + markId)
      }
      ink.setAttribute('opacity',frame.ink ? '1' : '0')
      svg.setAttribute('viewBox',viewBox(frame.explosion))
      leaders.setAttribute('opacity',String(Math.max(0,(frame.explosion - .86)/.14)))
      root.dataset.phase = frame.phase
      root.dataset.platenAngle = platen.toFixed(3)
      root.dataset.handleAngle = handle.toFixed(3)
    }
    const playback = playWhileVisible(root,durationMs,paint)
    function sync() {
      if (preference.matches || !window.IntersectionObserver) {
        playback.setEnabled(true)
        playback.refresh()
        return
      }
      playback.setEnabled(!!render)
      if (render || loading) return
      loading = true
      loadDrawing().then(data => {
        if (disposed) return
        render = createDraftingRenderer(data)
        playback.setEnabled(true)
      }).catch(() => {
        if (!disposed) paint(1)
      })
    }
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) sync()
    }, { rootMargin: '240px' }) : null
    if (preference.matches || !observer) sync()
    else playback.setEnabled(false)
    observer?.observe(root)
    preference.addEventListener('change',sync)
    return () => {
      disposed = true
      preference.removeEventListener('change',sync)
      observer?.disconnect()
      playback.dispose()
    }
  }, [markId])
  return (
    <figure ref={host} data-study="hero" className="studio-scene press-hero-drawing">
      <svg viewBox={viewBox(0)} preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby={title + ' ' + description}
        style={{ color: 'var(--muted)' }}>
        <title id={title}>Hand platen printing press</title>
        <desc id={description}>
          The press separates into its working parts, then reassembles. The handle lowers, the rollers ink the type,
          and the platen presses the card against it. The handle rises and the printed card reads www.
        </desc>
        <use data-plate="" href="/images/adana/registered.svg#plate" />
        <g data-live="" display="none" transform="scale(.1)" stroke="currentColor" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path data-stroke="outline" strokeWidth="10.5" />
          <path data-stroke="edge" strokeWidth="6" strokeOpacity=".84" />
          <path data-stroke="detail" strokeWidth="6" strokeOpacity=".74" />
        </g>
        <defs>
          <path id={markId} data-stroke="impression" transform="scale(.1)" fill="none" stroke="currentColor"
            strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
        </defs>
        <g data-motion="impression" opacity="0" style={{ color: 'var(--accent)' }}>
          <use data-mark="" href="/images/adana/registered.svg#mark" />
        </g>
        <g data-leaders="" opacity="0" aria-hidden="true" fontFamily="monospace" fontSize="13" letterSpacing=".6">
          <g stroke="currentColor" strokeOpacity=".76" strokeWidth=".8" fill="none">
            <path d="M126 -509l18 -15h45 M-168 -424l-24 -25h-50 M308 -163l25 20h51" />
          </g>
          <g fill="currentColor">
            <text x="198" y="-520">INK DISC</text>
            <text x="-251" y="-445" textAnchor="end">TYPE CHASE</text>
            <text x="384" y="-126" textAnchor="end">INK ROLLERS</text>
          </g>
        </g>
      </svg>
    </figure>
  )
}

export default memo(StudioScene)
