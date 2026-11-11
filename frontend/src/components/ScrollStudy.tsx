import { useEffect, useRef, type ReactNode } from 'react'
import { playWhileVisible } from './visible-playback'
import './scroll-study.css'

export interface StudyScene {
  resize(width: number, height: number): void
  render(progress: number): void
  dispose(): void
}

type StudyLoader = () => Promise<{
  create(host: HTMLDivElement, canvas: HTMLCanvasElement): StudyScene
}>

interface Props {
  kind: 'hero' | 'print'
  className: string
  load: StudyLoader
  fallback: ReactNode
  durationMs?: number
}

export default function ScrollStudy({ kind, className, load, fallback, durationMs = kind === 'hero' ? 4500 : 5200 }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const root = host.current!
    const surface = canvas.current!
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
      root.dataset.fallback = 'true'
      return
    }

    let scene: StudyScene | undefined
    let playback: ReturnType<typeof playWhileVisible> | undefined
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    let requested = false
    let near = kind === 'hero'
    let lost = false
    function showFallback() {
      lost = true
      playback?.setEnabled(false)
      delete root.dataset.ready
      root.dataset.fallback = 'true'
    }
    function paint(progress: number) {
      if (!scene || lost) return
      try {
        scene.render(progress)
        root.dataset.ready = 'true'
        delete root.dataset.fallback
      } catch {
        showFallback()
      }
    }
    function fit() {
      if (!scene || lost) return
      const { width, height } = root.getBoundingClientRect()
      if (width && height) {
        scene.resize(width, height)
        playback?.refresh()
      }
    }

    function showPoster() {
      root.dataset.fallback = 'true'
      root.dataset.playback = 'still'
      root.dataset.progress = '1.0000'
    }
    async function initialize() {
      if (requested || disposed) return
      if (motion.matches) { showPoster(); return }
      if (!near) return
      requested = true
      try {
        const module = await load()
        if (disposed) return
        if (motion.matches) { requested = false; showPoster(); return }
        scene = module.create(root, surface)
        fit()
        playback = playWhileVisible(root, durationMs, paint)
        if (lost) playback.setEnabled(false)
      } catch {
        if (!disposed) showFallback()
      }
    }

    // Prepare the press just before entry. Its playback observes the real viewport.
    const preload = new IntersectionObserver(([entry]) => {
      near = entry.isIntersecting
      if (near) {
        preload.disconnect()
        void initialize()
      }
    }, { rootMargin: '160px 0px' })
    const resize = new ResizeObserver(fit)
    const contextLost = (event: Event) => { event.preventDefault(); showFallback() }
    const contextRestored = () => {
      lost = false
      fit()
      playback?.setEnabled(true)
    }
    surface.addEventListener('webglcontextlost', contextLost)
    surface.addEventListener('webglcontextrestored', contextRestored)
    resize.observe(root)
    motion.addEventListener('change', initialize)
    void initialize()
    if (kind === 'print') preload.observe(root)
    void document.fonts.ready.then(() => { if (!disposed) playback?.refresh() })
    return () => {
      disposed = true
      preload.disconnect()
      resize.disconnect()
      motion.removeEventListener('change', initialize)
      surface.removeEventListener('webglcontextlost', contextLost)
      surface.removeEventListener('webglcontextrestored', contextRestored)
      playback?.dispose()
      if (scene) {
        scene.dispose()
        if (!surface.isConnected) surface.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
      }
      delete root.dataset.ready
      delete root.dataset.fallback
      delete root.dataset.playback
      delete root.dataset.progress
    }
  }, [kind, load, durationMs])

  return <div className={`scroll-study ${className}`} ref={host} data-study={kind}>
    <div className="study-fallback" aria-hidden="true">{fallback}</div>
    <canvas className="study-canvas" ref={canvas} aria-hidden="true" />
  </div>
}
