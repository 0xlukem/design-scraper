import { createTimer } from 'animejs'

/** The clock advances only while the scene is on screen. Scrolling never seeks it. */
export function playWhileVisible(host: HTMLElement, durationMs: number, draw: (progress: number) => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const still = () => preference.matches || !canObserve
  let inView = false
  let enabled = true
  function paint(progress: number) {
    draw(progress)
    host.dataset.progress = progress.toFixed(4)
  }
  const clock = createTimer({
    duration: durationMs,
    autoplay: false,
    onUpdate: timer => paint(timer.progress),
    onComplete: () => { host.dataset.playback = 'complete' },
  })

  const refresh = () => { if (enabled) paint(still() ? 1 : clock.progress) }
  function sync() {
    if (enabled && inView && !document.hidden && !still() && !clock.completed) {
      clock.resume()
      host.dataset.playback = 'playing'
    } else {
      clock.pause()
      host.dataset.playback = still() ? 'still' : clock.completed ? 'complete' : 'paused'
    }
  }
  function preferenceChanged() {
    clock.pause().seek(0, true)
    refresh()
    sync()
  }

  const observer = canObserve ? new IntersectionObserver(([entry]) => {
    // Start when a small part is visible; keep playing until it actually leaves.
    const visible = entry.isIntersecting && entry.intersectionRatio > 0 && (inView || entry.intersectionRatio >= .08)
    if (visible && !inView && clock.completed) clock.seek(0, true)
    inView = visible
    sync()
  }, { threshold: [0, .08] }) : undefined
  refresh()
  sync()
  observer?.observe(host)
  document.addEventListener('visibilitychange', sync)
  preference.addEventListener('change', preferenceChanged)
  return {
    refresh,
    setEnabled(value: boolean) {
      enabled = value
      refresh()
      sync()
    },
    dispose() {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      preference.removeEventListener('change', preferenceChanged)
      clock.cancel()
      delete host.dataset.playback
      delete host.dataset.progress
    },
  }
}
