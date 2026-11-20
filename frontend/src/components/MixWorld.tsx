import { memo, useEffect, useRef } from 'react'
import './worlds.css'

/** The Home blender, framed inside Mix It's own hero. */
function MixWorld() {
  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const error = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const world = root.current!, host = surface.current!
    const hero = world.closest<HTMLElement>('.analysis-intro')!
    let disposed = false
    let cleanup: (() => void) | undefined
    const fallback = () => {
      if (disposed) return
      world.dataset.renderer = 'fallback'
      world.dataset.playback = 'still'
      error.current!.hidden = false
    }
    if (typeof WebGLRenderingContext === 'undefined' || typeof ResizeObserver === 'undefined' || typeof IntersectionObserver === 'undefined') {
      fallback()
      return
    }
    void import('../landing-scenes/mix.js').then(({ mountMix }) => {
      if (!disposed) cleanup = mountMix(hero, { variant: 'hero', host, state: world })
    }).catch(fallback)
    return () => { disposed = true; cleanup?.() }
  }, [])

  return <div ref={root} className="mix-world" data-renderer="loading" aria-hidden="true">
    <div ref={surface} className="mix-blender-scene" />
    <p ref={error} className="mix-scene-error" hidden>The animated scene is unavailable. You can still mix your references below.</p>
  </div>
}

export default memo(MixWorld)
