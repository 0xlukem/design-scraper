import { useEffect, useId, useRef, type CSSProperties, type PointerEvent, type ChangeEventHandler } from 'react'

interface Props {
  share: number
  valueText: string
  disabled?: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
}

// At either endpoint the outer wing retracts into the head so its silhouette stays round.
function gripShape(left: number, right: number) {
  return `M${-21 - 31 * left} ${-3.5 * left}
    C${-21 - 17 * left} ${-7 + 3.5 * left} ${-20 - 7 * left} -4.5 -17.4 -10.6
    C-12-17-5.5-20.5 2-19.4 C12-19.1 17-11.6 19.3-8
    C${20 + 8 * right} -3 ${21 + 19 * right} ${-6 + 2.5 * right} ${21 + 31 * right} ${-3.5 * right}
    V${3.5 * right} C${21 + 18 * right} ${6 - 2.5 * right} ${20 + 8 * right} 3.1 18.3 9.8
    C11.2 17.1 7.4 19.1-2 18.3 C-12 17.7-17 10-19.3 7.7
    C${-20 - 8 * left} 3.6 ${-21 - 19 * left} ${7 - 3.5 * left} ${-21 - 31 * left} ${3.5 * left} Z`
}

export default function StickyPaintRange({share, valueText, disabled = false, onChange}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const id = 'mix-paint-' + useId().replace(/:/g, '')
  const axis = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | null>(null)
  const motion = useRef({ value: 0, velocity: 0, target: 0, frame: 0, last: 0, pointerX: 0, pointerTime: 0 })
  const head = useRef<SVGGElement>(null)

  function animate(now: number) {
    const m = motion.current
    const dt = Math.min(1 / 30, (now - (m.last || now - 16)) / 1000)
    m.last = now
    // A damped material response driven by drag velocity, independent of the
    // native range value. Its recoil decays to rest instead of snapping on release.
    const acceleration = 190 * (m.target - m.value) - 18 * m.velocity
    m.velocity += acceleration * dt
    m.value += m.velocity * dt
    const stretch = Math.min(.4, Math.abs(m.value))
    head.current?.setAttribute('transform', `translate(${-m.value * 9} 0) rotate(${m.value * 9}) scale(${1 + stretch} ${1 / (1 + stretch)})`)
    if (Math.abs(m.value - m.target) > .0004 || Math.abs(m.velocity) > .002) m.frame = requestAnimationFrame(animate)
    else { m.frame = 0; m.last = 0; if (!pointer.current) head.current?.removeAttribute('transform') }
  }
  function energize(velocity: number) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    motion.current.target = Math.max(-.4, Math.min(.4, velocity / 2200))
    if (!motion.current.frame) motion.current.frame = requestAnimationFrame(animate)
  }
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => { cancelAnimationFrame(motion.current.frame); Object.assign(motion.current, { frame: 0, last: 0, value: 0, velocity: 0, target: 0 }); head.current?.removeAttribute('transform') }
    media.addEventListener('change', stop)
    window.addEventListener('blur', stop)
    return () => { stop(); media.removeEventListener('change', stop); window.removeEventListener('blur', stop) }
  }, [])

  function follow(event: PointerEvent<HTMLInputElement>) {
    if (pointer.current !== event.pointerId || !root.current || !axis.current) return
    const { left, width } = axis.current.getBoundingClientRect()
    if (width <= 0) return
    const m = motion.current, now = event.timeStamp
    if (m.pointerTime) energize((event.clientX - m.pointerX) / Math.max(8, now - m.pointerTime) * 1000)
    m.pointerX = event.clientX; m.pointerTime = now
    const fraction = Math.max(0, Math.min(1, (event.clientX - left) / width))
    root.current.style.setProperty('--paint-position', `${fraction * 100}%`)
    // Retract the outward tip at the ends of the rail.
    const shape = root.current.querySelector('.paint-outline')
    shape?.setAttribute('d', gripShape(Math.min(1, fraction * width / 55), Math.min(1, (1 - fraction) * width / 55)))
  }

  function release(input: HTMLInputElement) {
    pointer.current = null
    motion.current.pointerTime = 0
    energize(0)
    root.current?.removeAttribute('data-dragging')
    root.current?.style.removeProperty('--paint-position')
    root.current?.querySelector('.paint-outline')?.setAttribute('d', gripShape(input.value === '0' ? 0 : 1, input.value === '100' ? 0 : 1))
  }
  return <div ref={root} className="paint-range" style={{'--first-share': `${share}%`} as CSSProperties}>
    <div ref={axis} className="paint-range-axis" aria-hidden="true">
      <div className="paint-rail"/>
      <svg className="paint-grip" viewBox="-78 -32 156 64" width="156" height="64" focusable="false">
        <defs>
          <radialGradient id={id + '-lime'} cx=".39" cy=".22" r=".88">
            <stop stopColor="#faffc4"/><stop offset=".34" stopColor="#efff76"/>
            <stop offset=".68" stopColor="#d9ee50"/><stop offset=".86" stopColor="#9ab72e"/><stop offset="1" stopColor="#e8f99a"/>
          </radialGradient>
          <radialGradient id={id + '-pink'} cx=".53" cy=".2" r=".93">
            <stop stopColor="#ffe0f3"/><stop offset=".36" stopColor="#ff94d5"/>
            <stop offset=".67" stopColor="#f267bc"/><stop offset=".88" stopColor="#b93b83"/><stop offset="1" stopColor="#ffa1db"/>
          </radialGradient>
          <path className="paint-outline" id={id + '-shape'} d={gripShape(share === 0 ? 0 : 1, share === 100 ? 0 : 1)}/>
          <linearGradient id={id + '-taper'} gradientUnits="userSpaceOnUse" x1="-52" x2="52">
            <stop stopColor="white" stopOpacity="0"/><stop offset=".2" stopColor="white"/>
            <stop offset=".8" stopColor="white"/><stop offset="1" stopColor="white" stopOpacity="0"/>
          </linearGradient>
          <mask id={id + '-join'} maskUnits="userSpaceOnUse" x="-53" y="-24" width="106" height="48">
            <rect x="-53" y="-24" width="106" height="48" fill={'url(#' + id + '-taper)'}/>
          </mask>
          <clipPath id={id + '-clip'}><use href={'#' + id + '-shape'}/></clipPath>
        </defs>
        <g ref={head} className="paint-head" mask={'url(#' + id + '-join)'}>
          <use href={'#' + id + '-shape'} fill={'url(#' + id + '-lime)'} />
          <g clipPath={'url(#' + id + '-clip)'}>
            <path d="M9-21C22-13 16.5-3.3 9 3.8C2.4 10.2.6 14.9 3.5 21H55V-23Z" fill={'url(#' + id + '-pink)'}/>
            <path d="M11-18C20.6-9.2 15-2 8.1 4.7C4.5 8.5 1.4 13.8 2.2 17.5" fill="none" stroke="#777235" strokeWidth=".85" opacity=".56"/>
            <path d="M13.1-15C19.8-7.6 14.1-.7 10.1 3.7" fill="none" stroke="#fff5fb" strokeWidth="1.1" strokeLinecap="round" opacity=".88"/>
            <path d="M-43-1.8C-29-1.7-24-4.8-20-8.4C-15-14-7.4-18.6.1-17.8" fill="none" stroke="#fcffd6" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M-15.9-7.6C-13.5-13.1-6-16.3-.4-15.6C-3.7-15-7.3-13.9-9.3-11.7L-12-12.5Z" fill="#ffffef"/>
            <path d="M-16.2 10.1C-7.5 17.8-3.2 17.8 1.7 17" fill="none" stroke="#f0fbb1" strokeLinecap="round" opacity=".7"/>
            <path d="M18.7-9.3C24-1.1 36-2.3 49-2.1" fill="none" stroke="#ffe2f3" strokeWidth="1.2" strokeLinecap="round"/>
          </g>
        </g>
      </svg>
    </div>
    <input id="mix-bias" type="range" min="0" max="100" step="25" value={share} disabled={disabled}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return
        pointer.current = event.pointerId
        root.current?.setAttribute('data-dragging', '')
        event.currentTarget.setPointerCapture(event.pointerId)
        motion.current.pointerX = event.clientX
        motion.current.pointerTime = 0
        follow(event)
      }}
      onPointerMove={follow}
      onLostPointerCapture={event => release(event.currentTarget)}
      onBlur={event => release(event.currentTarget)}
      aria-valuetext={valueText} onChange={onChange} className="blend-slider" list="blend-stops"/>
    <datalist id="blend-stops">{[0, 25, 50, 75, 100].map(stop => <option key={stop} value={stop}/>)}</datalist>
  </div>
}
