import { type RefObject, useCallback, useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

/** Keeps decorative GSAP work off the React render loop and out of hidden tabs. */
export function useSceneMotion(
  root: RefObject<HTMLElement>,
  paused: boolean,
  createTimeline: () => gsap.core.Timeline,
  minimumVisibleRatio = 0,
) {
  const animation = useRef<gsap.core.Timeline | null>(null)
  const pauseRequested = useRef(paused)
  const visible = useRef(false)
  const syncPlayback = useCallback(() => {
    animation.current?.paused(pauseRequested.current || !visible.current || document.hidden)
  }, [])

  useEffect(() => {
    pauseRequested.current = paused
    syncPlayback()
  }, [paused, syncPlayback])

  useGSAP(() => {
    visible.current = typeof IntersectionObserver === 'undefined'
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      animation.current = createTimeline()
      syncPlayback()
      return () => { animation.current = null }
    }, root)

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      visible.current = entry.isIntersecting && entry.intersectionRatio >= minimumVisibleRatio
      syncPlayback()
    }, { threshold: minimumVisibleRatio })
    if (root.current) observer?.observe(root.current)
    document.addEventListener('visibilitychange', syncPlayback)
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncPlayback)
      media.revert()
    }
  }, { scope: root })
}
