import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { AppMode } from '../types'
import './world-transition.css'

gsap.registerPlugin(useGSAP)

const paintColors = ['#ff5caa', '#ff793d', '#ffe95e', '#ccff67', '#6de5f3', '#516cf5', '#a477eb']
const grayscaleColors = paintColors.map(color => {
  const linear = [1, 3, 5].map(offset => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  const encoded = luminance <= 0.0031308 ? luminance * 12.92 : 1.055 * luminance ** (1 / 2.4) - 0.055
  const gray = Math.round(encoded * 255).toString(16).padStart(2, '0')
  return `#${gray}${gray}${gray}`
})
const ribbonRotations = [-15, 9, -8, 13, -12, 7, -6]
const droplets = [
  [8, 12, 42], [28, 6, 24], [68, 14, 36], [91, 22, 28],
  [14, 39, 18], [82, 45, 48], [6, 76, 30], [32, 84, 42],
  [57, 91, 22], [89, 81, 36], [46, 25, 17], [68, 66, 25],
]

/** The paint fully covers the viewport at this point; the world swaps underneath. */
export const WORLD_COVERED_AT = 0.5

/**
 * A one-shot paint interlude. `target` is the requested world and `current` the
 * one on screen: the switch itself happens through `onCovered`, either at full
 * coverage or immediately when the paint cannot play. The timeline never owns
 * navigation or focus.
 */
export default function WorldTransition({ target, current, paused, onCovered }: { target: AppMode; current: AppMode; paused: boolean; onCovered: (mode: AppMode) => void }) {
  const scene = useRef<HTMLDivElement>(null)
  const previousTarget = useRef(target)
  const covered = useRef(onCovered)
  covered.current = onCovered
  const mode = target

  useGSAP(() => {
    const root = scene.current
    const changed = previousTarget.current !== target
    previousTarget.current = target
    if (!root) return

    const hide = () => {
      root.dataset.state = 'idle'
      root.style.opacity = '0'
    }
    hide()

    // Mounting, resuming, and returning to a hidden tab must not replay a switch.
    // A reversal before coverage simply drops the pending paint.
    if (!changed || target === current) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (paused || reducedMotion.matches || document.hidden) { covered.current(target); return }

    const direction = mode === 'mix' ? 1 : -1
    const flood = root.querySelector('.world-transition-flood')
    const ribbons = root.querySelectorAll('.world-transition-ribbon')
    const drops = root.querySelectorAll('.world-transition-drop')
    const timeline = gsap.timeline({ onComplete: hide })

    // Restore the same saturated starting palette on every switch, including
    // rapid reversals after a partially desaturated return to the studio.
    const floodIndex = mode === 'mix' ? 6 : 0
    gsap.set(flood, { backgroundColor: paintColors[floodIndex] })
    gsap.set(ribbons, { color: (index: number) => paintColors[index] })
    gsap.set(drops, { backgroundColor: (index: number) => paintColors[(index + 2) % paintColors.length] })

    root.dataset.state = 'covering'
    root.style.opacity = '1'

    timeline.fromTo(flood, {
      scale: 0.015, xPercent: -26 * direction, yPercent: 27, rotation: -32 * direction,
    }, {
      scale: 1.06, xPercent: 0, yPercent: 0, rotation: 7 * direction,
      duration: 0.44, ease: 'power3.out',
    }, 0)
    timeline.fromTo(ribbons, {
      xPercent: -130 * direction, scaleY: 0.52,
      rotation: (index: number) => ribbonRotations[index] - 12 * direction,
    }, {
      xPercent: 0, scaleY: 1,
      rotation: (index: number) => ribbonRotations[index],
      duration: 0.46, stagger: 0.018, ease: 'power3.out',
    }, 0.025)
    timeline.fromTo(drops, {
      scale: 0, x: -90 * direction, y: 65, rotation: -35 * direction, opacity: 0,
    }, {
      scale: 1, x: 0, y: 0, rotation: 18 * direction, opacity: 1,
      duration: 0.39, stagger: 0.013, ease: 'back.out(1.8)',
    }, 0.08)

    // The requested world renders only once the paint hides the swap.
    timeline.call(() => { covered.current(target) }, [], WORLD_COVERED_AT)

    if (mode === 'single') {
      // Returning to the studio: the twenty paint shapes arrive saturated and
      // drain to their luminance-matched grays while they retreat, so the
      // monochrome world is revealed by monochrome paint.
      const desaturate = { duration: 0.42, ease: 'power1.inOut' }
      timeline.to(flood, { ...desaturate, backgroundColor: grayscaleColors[floodIndex] }, WORLD_COVERED_AT)
      timeline.to(ribbons, { ...desaturate, color: (index: number) => grayscaleColors[index] }, WORLD_COVERED_AT)
      timeline.to(drops, { ...desaturate, backgroundColor: (index: number) => grayscaleColors[(index + 2) % paintColors.length] }, WORLD_COVERED_AT)
    }

    timeline.call(() => { root.dataset.state = 'revealing' }, [], 0.58)
    timeline.to(ribbons, {
      xPercent: 135 * direction, scaleY: 0.65,
      rotation: (index: number) => ribbonRotations[index] + 18 * direction,
      duration: 0.42, stagger: 0.015, ease: 'power3.inOut',
    }, 0.59)
    timeline.to(flood, {
      scale: 0.015, xPercent: 30 * direction, yPercent: -30, rotation: 36 * direction,
      duration: 0.48, ease: 'power3.inOut',
    }, 0.63)
    timeline.to(drops, {
      scale: 0, x: 115 * direction, y: -90, rotation: 60 * direction, opacity: 0,
      duration: 0.27, stagger: 0.012, ease: 'power2.in',
    }, 0.68)
    timeline.call(hide, [], 1.12)

    const stop = () => { timeline.kill(); hide() }
    const onPreferenceChange = () => { if (reducedMotion.matches) stop() }
    const onVisibilityChange = () => { if (document.hidden) stop() }
    reducedMotion.addEventListener('change', onPreferenceChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      reducedMotion.removeEventListener('change', onPreferenceChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, { scope: scene, dependencies: [target], revertOnUpdate: true })

  return <div ref={scene} className="world-transition" data-state="idle" data-target={mode} data-paused={paused} aria-hidden="true">
    <div className="world-transition-flood" />
    {paintColors.map((color, index) => <svg
      key={color}
      className="world-transition-ribbon"
      viewBox="0 0 1600 500"
      preserveAspectRatio="none"
      focusable="false"
      style={{ top: `${-22 + index * 16}%`, color }}
    >
      <path fill="currentColor" d="M-130 112C49 27 94 158 247 105C388 54 399-15 557 52C729 127 770 30 942 67C1112 103 1225-35 1413 47C1506 88 1580 57 1718 116L1718 398C1575 459 1498 363 1361 429C1172 519 1097 380 925 435C743 494 680 361 510 426C352 486 245 380 107 432C-28 482-52 374-130 401Z" />
      <path className="world-transition-ribbon-glint" fill="currentColor" d="M120 129C255 165 376 59 480 85C527 96 536 114 567 124C394 87 290 201 120 149ZM985 113C1129 138 1189 50 1320 70C1195 78 1146 172 985 133Z" />
    </svg>)}
    {droplets.map(([left, top, size], index) => <span key={index} className="world-transition-drop" style={{
      left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size * (index % 3 === 0 ? 1.8 : 1)}px`,
      backgroundColor: paintColors[(index + 2) % paintColors.length],
    }} />)}
  </div>
}
