import { memo, useRef } from 'react'
import gsap from 'gsap'
import { useSceneMotion } from './useSceneMotion'
import './worlds.css'

function MixWorld({ paused }: { paused: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  useSceneMotion(root, paused, () => gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
    .to('.mix-paint-sculpture', { rotation: 3.5, y: -18, x: 9, scale: 1.035, duration: 6 }, 0)
    .to('.mix-ribbon-back', { rotation: -7, scale: 1.035, duration: 7 }, .5)
    .to('.mix-paint-drop-one', { y: -28, x: -7, rotation: 14, duration: 4 }, 1.2)
    .to('.mix-paint-drop-two', { y: 21, x: 13, rotation: -18, duration: 4.5 }, 1.9)
    .to('.mix-orbit-line', { rotation: 9, duration: 6 }, 2.3))

  return <div ref={root} className="mix-world" aria-hidden="true">
    <svg className="mix-ribbon-back" viewBox="0 0 800 650" fill="none">
      <path d="M-65 360C40 79 559 542 706 310C817 133 372 39 466 332C533 541 945 410 772 136" stroke="#f451bb" strokeWidth="62" />
      <path d="M-65 347C40 66 559 529 706 297C817 120 372 26 466 319C533 528 945 397 772 123" stroke="#ff95d4" strokeWidth="8" />
    </svg>
    <svg className="mix-orbit-line" viewBox="0 0 800 650" fill="none"><ellipse cx="399" cy="330" rx="353" ry="187" stroke="currentColor" strokeWidth="1.3" transform="rotate(-23 399 330)" /><path d="M49 446H74M62 434V459M708 163H733M721 151V176" stroke="currentColor" strokeWidth="1.3" /></svg>
    <img className="mix-paint-sculpture" src="/images/mix-it-paint-sculpture.webp" alt="" width="1536" height="1024" decoding="async" draggable="false" />
    <div className="mix-paint-drop mix-paint-drop-one" />
    <div className="mix-paint-drop mix-paint-drop-two" />
    <span className="mix-world-note">GOOD TASTE. ZERO GRAVITY.</span>
  </div>
}

export default memo(MixWorld)
