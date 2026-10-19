import { memo, useRef } from 'react'
import gsap from 'gsap'
import { useSceneMotion } from './useSceneMotion'
import './worlds.css'

/** An illustrative type specimen, not a claim about a submitted website. */
function StudioScene({ paused }: { paused: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  useSceneMotion(root, paused, () => gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } })
    .to('.studio-scan', { x: (root.current?.clientWidth || 560) * .48, duration: 7 }, 0)
    .to('.studio-glyph-outline', { x: 6, duration: 5 }, 1)
    .to('.studio-scale-bars i', { scaleX: .84, duration: 3, stagger: .18, transformOrigin: 'left center' }, 2))

  return <div ref={root} className="studio-scene" aria-hidden="true">
    <div className="studio-meta"><span>THE ANATOMY OF A WEBSITE</span><span className="studio-cross">+</span></div>
    <div className="studio-specimen">
      <div className="studio-rule studio-rule-cap"><span>CAP HEIGHT</span></div>
      <div className="studio-rule studio-rule-base"><span>BASELINE</span></div>
      <div className="studio-tick-ruler" />
      <div className="studio-glyph"><span>A</span><span className="studio-glyph-outline">a</span></div>
      <div className="studio-scan"><i /><span>EXTRACT</span></div>
      <div className="studio-detail-column">
        <div><span className="studio-detail-label">01 / TYPE</span><strong>Form &amp; rhythm</strong></div>
        <div><span className="studio-detail-label">02 / COLOR</span><div className="studio-tones"><i /><i /><i /><i /><i /></div></div>
        <div><span className="studio-detail-label">03 / SPACE</span><div className="studio-scale-bars"><i /><i /><i /></div></div>
      </div>
    </div>
    <div className="studio-bottom"><span>REFERENCE <b>→</b> SYSTEM</span><span>See what makes it work.</span></div>
  </div>
}

export default memo(StudioScene)
