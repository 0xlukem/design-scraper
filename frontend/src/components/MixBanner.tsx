import { Fragment, useRef } from 'react'
import gsap from 'gsap'
import { useSceneMotion } from './useSceneMotion'

const message = 'Never the same mix twice.'
const revealThreshold = 0.8

export default function MixBanner() {
  const banner = useRef<HTMLElement>(null)
  useSceneMotion(banner, false, () => {
    return gsap.timeline({ paused: true }).from('.mix-banner-word', {
      yPercent: 65,
      rotation: -4,
      opacity: 0,
      duration: 0.85,
      stagger: 0.085,
      ease: 'power3.out',
      clearProps: 'transform,opacity',
    })
  }, revealThreshold)

  return <section ref={banner} className="mix-banner">
    <h2 aria-label={message}>
      {message.split(' ').map((word, index) => (
        <Fragment key={word}>
          {index > 0 && ' '}
          <span className="mix-banner-word" aria-hidden="true">{word}</span>
        </Fragment>
      ))}
    </h2>
  </section>
}
