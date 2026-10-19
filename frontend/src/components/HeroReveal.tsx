import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { AppMode } from '../types'

gsap.registerPlugin(useGSAP)

/** A short entrance, isolated from forms and their interactive state. */
export default function HeroReveal({ mode, paused, children }: { mode: AppMode; paused: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const entrance = useRef<gsap.core.Timeline | null>(null)
  const previousMode = useRef(mode)
  const pauseRequested = useRef(paused)
  pauseRequested.current = paused
  useGSAP(() => {
    const changed = previousMode.current !== mode
    previousMode.current = mode
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      if (pauseRequested.current) return
      entrance.current = gsap.timeline({ delay: changed ? .3 : .05, defaults: { duration: .9, ease: 'power3.out' } })
        .from('.section-kicker', { autoAlpha: 0, y: 10 }, 0)
        .from('.experience-headline', { autoAlpha: 0, y: mode === 'mix' ? 34 : 21 }, .08)
        .from('.analysis-description, .hero-actions', { autoAlpha: 0, y: 12, stagger: .08 }, .2)
      return () => { entrance.current = null }
    }, root)
    return () => media.revert()
  }, { scope: root, dependencies: [mode], revertOnUpdate: true })
  useEffect(() => {
    if (paused) entrance.current?.progress(1).pause()
  }, [paused])
  return <div ref={root} className="analysis-intro">{children}</div>
}
