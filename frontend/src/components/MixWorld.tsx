import { memo, useEffect, useRef } from 'react'
import { createScope, createTimeline } from 'animejs'
import { playWhileVisible } from './visible-playback'
import './worlds.css'

function MixWorld() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = root.current!
    const scope = createScope({ root: target })
    scope.add(() => {
      const timeline = createTimeline({ autoplay: false, defaults: { duration: 4500, ease: 'inOutSine' } })
        .add('.mix-paint-sculpture', { rotate: [-5, 4], y: [0, -22], x: [0, 8], scale: [1, 1.035] }, 0)
        .add('.mix-ribbon-back', { rotate: [6, -7], scale: [1, 1.035] }, 0)
        .add('.mix-paint-drop-one', { y: [0, -28], x: [0, -7], rotate: [-23, -9] }, 0)
        .add('.mix-paint-drop-two', { y: [0, 21], x: [0, 13], rotate: [34, 16] }, 0)
        .add('.mix-orbit-line', { rotate: [0, 9] }, 0)
      const playback = playWhileVisible(target, timeline.duration, progress => timeline.seek(progress * timeline.duration, true))
      return () => playback.dispose()
    })
    return () => scope.revert()
  }, [])

  return <div ref={root} className="mix-world" aria-hidden="true">
    <svg className="mix-ribbon-back" viewBox="0 0 800 650" fill="none">
      <path d="M-65 360C40 79 559 542 706 310C817 133 372 39 466 332C533 541 945 410 772 136" stroke="#f451bb" strokeWidth="62" />
      <path d="M-65 347C40 66 559 529 706 297C817 120 372 26 466 319C533 528 945 397 772 123" stroke="#ff95d4" strokeWidth="8" />
    </svg>
    <svg className="mix-orbit-line" viewBox="0 0 800 650" fill="none"><ellipse cx="399" cy="330" rx="353" ry="187" stroke="currentColor" strokeWidth="1.3" transform="rotate(-23 399 330)" /><path d="M49 446H74M62 434V459M708 163H733M721 151V176" stroke="currentColor" strokeWidth="1.3" /></svg>
    <img className="mix-paint-sculpture" src="/images/mix-it-paint-sculpture.webp" alt="" width="1536" height="1024" decoding="async" draggable="false" />
    <div className="mix-paint-drop mix-paint-drop-one" />
    <div className="mix-paint-drop mix-paint-drop-two" />
  </div>
}

export default memo(MixWorld)
