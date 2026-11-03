import { animate } from 'framer-motion'
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

  const faq = [...document.querySelectorAll<HTMLDetailsElement>('.faq details')]
  const animations = new Map<HTMLElement, ReturnType<typeof animate>>()
  const toggle = (event: Event) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const item = event.currentTarget as HTMLDetailsElement
    const icon = item.querySelector<HTMLElement>('summary span')!
    animations.get(icon)?.stop()
    animations.set(icon, animate(icon, { rotate: item.open ? [0, 45] : [45, 0] }, { duration: .2 }))
  }
  faq.forEach(item => item.addEventListener('toggle', toggle))
  const dispose = () => {
    if (disposed) return
    disposed = true
    lazyMix.disconnect()
    cleanups.forEach(cleanup => cleanup())
    faq.forEach(item => item.removeEventListener('toggle', toggle))
    animations.forEach(control => control.stop())
    window.removeEventListener('pagehide', pagehide)
  }
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) dispose() }
  window.addEventListener('pagehide', pagehide)
  if (import.meta.hot) import.meta.hot.dispose(dispose)
}
