import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import './landing-scenes/scenes.css'
import { mountExportReveal } from './landing-exports'

/** Load the approved WebGL scenes independently of the static home content. */
export function initLandingMotion() {
  let disposed = false
  const cleanups: (() => void)[] = [mountExportReveal(document.querySelector<HTMLElement>('.exports')!)]
  const hero = document.querySelector<HTMLElement>('.hero')!
  const mix = document.querySelector<HTMLElement>('#mix-it')!
  void import('./landing-scenes/hero.js').then(({ mountHero }) => {
    if (!disposed) cleanups.push(mountHero(hero))
  })
  // The blender and its geometry are only constructed as the banner approaches.
  const lazyMix = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    lazyMix.disconnect()
    void import('./landing-scenes/mix.js').then(({ mountMix }) => {
      if (!disposed) cleanups.push(mountMix(mix))
    })
  }, { rootMargin: '500px' })
  lazyMix.observe(mix)

  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let scroll: Lenis | undefined
  const syncScroll = () => {
    scroll?.destroy()
    scroll = motion.matches ? undefined : new Lenis({ autoRaf: true, anchors: true, lerp: .14 })
  }
  syncScroll()
  motion.addEventListener('change', syncScroll)
  const dispose = () => {
    if (disposed) return
    disposed = true
    lazyMix.disconnect()
    cleanups.forEach(cleanup => cleanup())
    motion.removeEventListener('change', syncScroll)
    scroll?.destroy()
    window.removeEventListener('pagehide', pagehide)
  }
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) dispose() }
  window.addEventListener('pagehide', pagehide)
  if (import.meta.hot) import.meta.hot.dispose(dispose)
}
