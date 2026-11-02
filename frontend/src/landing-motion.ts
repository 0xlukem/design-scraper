import { gsap } from 'gsap'
import { animate } from 'framer-motion'

type Scene = { timeline: gsap.core.Timeline; still: number; phases: [number, string][] }
type BuildScene = (root: HTMLElement, mobile: boolean) => Scene

/** Decorative saved-material illustrations. No API, audio or analysis requests. */
export function initLandingMotion() {
  const disposers = [mountScene('.hero', '#hero-motion', buildHero), mountScene('.mix-section', '#mix-motion', buildMix)]
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
  let resizeFrame = 0, disposed = false
  const refresh = () => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => gsap.matchMediaRefresh())
  }
  window.addEventListener('resize', refresh)
  void document.fonts.ready.then(() => { if (!disposed) refresh() })
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    disposed = true
    cancelAnimationFrame(resizeFrame)
    window.removeEventListener('resize', refresh)
    disposers.forEach(dispose => dispose())
    faq.forEach(item => item.removeEventListener('toggle', toggle))
    animations.forEach(control => control.stop())
  })
}

function mountScene(selector: string, buttonSelector: string, build: BuildScene) {
  const root = document.querySelector<HTMLElement>(selector)!
  const button = root.querySelector<HTMLButtonElement>(buttonSelector)!
  const media = gsap.matchMedia()
  let timeline: gsap.core.Timeline | undefined
  let reduced = false, inView = false, userPaused = false, pageAway = false
  const label = selector === '.hero' ? 'hero' : 'Mix It'
  const sync = () => {
    const paused = reduced || userPaused || !inView || document.hidden || pageAway
    timeline?.paused(paused)
    button.textContent = userPaused ? 'Play' : 'Pause'
    button.setAttribute('aria-label', `${userPaused ? 'Play' : 'Pause'} ${label} animation`)
    root.dataset.playback = paused ? 'paused' : 'playing'
  }
  media.add({ mobile: '(max-width: 760px)', desktop: '(min-width: 761px)', reduced: '(prefers-reduced-motion: reduce)' }, context => {
    reduced = !!context.conditions?.reduced
    const scene = build(root, !!context.conditions?.mobile)
    timeline = scene.timeline
    root.dataset.motionReady = ''
    root.dataset.cycle = '0'
    timeline.eventCallback('onRepeat', () => { root.dataset.cycle = String(Number(root.dataset.cycle) + 1) })
    timeline.eventCallback('onUpdate', () => {
      const phase = [...scene.phases].reverse().find(([time]) => timeline!.time() >= time)?.[1] || 'ready'
      if (root.dataset.phase !== phase) root.dataset.phase = phase
    })
    if (reduced) timeline.time(scene.still).pause()
    button.hidden = reduced
    sync()
    return () => { timeline?.kill(); timeline = undefined }
  }, root)
  const intersection = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync() }, { threshold: .08 })
  intersection.observe(root)
  const toggle = () => { userPaused = !userPaused; sync() }
  const pagehide = () => { pageAway = true; sync() }
  const pageshow = () => { pageAway = false; sync() }
  button.addEventListener('click', toggle)
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('pageshow', pageshow)
  const resize = new ResizeObserver(() => {
    const world = root.querySelector<HTMLElement>('.hero-world')
    if (world) world.style.transform = `scale(${world.parentElement!.clientWidth / 900})`
  })
  resize.observe(root)
  return () => {
    media.revert(); intersection.disconnect(); resize.disconnect()
    button.removeEventListener('click', toggle)
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('pagehide', pagehide)
    window.removeEventListener('pageshow', pageshow)
  }
}

function buildHero(root: HTMLElement): Scene {
  const source = root.querySelector('.source-sheet')!
  const bar = root.querySelector('.scrape-bar')!
  const strips = [...root.querySelectorAll('.scratch-strip')]
  const tokens = [...root.querySelectorAll('.hero-token')]
  const disc = root.querySelector('.record-disc')!
  const timeline = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1, defaults: { ease: 'power3.inOut' } })
  timeline.set(source, { x: 0, y: 0, rotation: -10, scale: 1, autoAlpha: 1 })
    .set(bar, { y: 0, scaleX: 1, autoAlpha: 0 })
    .set(strips, { x: 0, y: 0, autoAlpha: 0 })
    .set(tokens, { x: -200, y: -180, scale: .4, rotation: -18, autoAlpha: 0 })
    .set(disc, { rotation: -16, scale: 1 })
    .to(source, { rotation: -3, x: 22, duration: .3 }, 1.8)
    .to(source, { rotation: -12, x: -8, duration: .18 }, 2.1)
    .to(source, { rotation: -6, x: 5, duration: .3 }, 2.28)
    .set(bar, { autoAlpha: 1 }, 2.6)
    .to(bar, { y: 335, duration: 3.3, ease: 'none' }, 2.6)
    .to(disc, { rotation: 35, duration: .3 }, 1.8)
    .to(disc, { rotation: -25, duration: .18 }, 2.1)
    .to(disc, { rotation: 155, duration: 3.5 }, 2.6)
  strips.forEach((strip, i) => {
    timeline.to(strip, { autoAlpha: 1, x: 55 + i * 35, y: -20, rotation: -10 + i * 4, duration: .22 }, 3.2 + i * .6)
      .to(strip, { x: 180 + i * 40, y: 180, autoAlpha: 0, duration: 1.4 }, 3.6 + i * .6)
  })
  tokens.forEach((token, i) => {
    const at = 4.2 + i * .7
    timeline.to(token, { autoAlpha: 1, scale: 1, x: 0, y: 12, rotation: -7 + i * 2, duration: .9, ease: 'power4.out' }, at)
      .to(token, { y: 0, duration: .22, ease: 'power2.out' }, at + .9)
  })
  timeline.to(source, { x: -75, y: 70, scale: .86, rotation: -14, duration: 2 }, 5)
    .to(bar, { autoAlpha: 0, duration: .2 }, 5.9)
    .to(disc, { rotation: 335, duration: 6, ease: 'none' }, 7)
  tokens.forEach((token, i) => {
    timeline.to(token, { x: -200, y: -180, scale: .4, rotation: -18, autoAlpha: 0, duration: 1.3 }, 17.5 + i * .35)
  })
  timeline.to(source, { x: 0, y: 0, scale: 1, rotation: -10, duration: 2 }, 19)
    .to(disc, { rotation: 344, duration: 2 }, 19)
    .to({}, { duration: 3 }, 21)
  return { timeline, still: 11, phases: [[0, 'reference'], [2.6, 'scratch'], [4.2, 'drop'], [8, 'system'], [17.5, 'resample']] }
}

function buildMix(root: HTMLElement, mobile: boolean): Scene {
  const blender = root.querySelector('.blender')!
  const ingredients = [...root.querySelectorAll('.ingredient')]
  const jar = [...root.querySelectorAll('.jar-tokens span')]
  const tokens = [...root.querySelectorAll('.mix-flight > *')]
  const timeline = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1, defaults: { ease: 'power3.inOut' } })
  const bounds = root.getBoundingClientRect(), image = blender.getBoundingClientRect()
  const mouth = { x: image.left - bounds.left + image.width * .45, y: image.top - bounds.top + image.height * .055 }
  timeline.set(blender, { xPercent: -50, x: 0, rotation: 0 })
    .set(tokens, { left: 0, top: 0, x: mouth.x, y: mouth.y, scale: .15, autoAlpha: 0 })
    .set(ingredients, { x: 0, y: 0, scale: 1, autoAlpha: 1 })
    .set(jar, { x: 0, y: 0, rotation: 0, scale: .7, autoAlpha: .9 })
  ingredients.forEach((ingredient, i) => {
    const target = ingredient.getBoundingClientRect()
    timeline.to(ingredient, { x: mouth.x - (target.left - bounds.left) - target.width / 2, y: mouth.y - (target.top - bounds.top) + 85, rotation: i ? -30 : 40, scale: .3, duration: 1.9, ease: 'power3.in' }, .8 + i * .6)
      .to(ingredient, { autoAlpha: 0, duration: .2 }, 2.6 + i * .6)
  })
  timeline.to(blender, { rotation: 1.3, duration: .09, repeat: 127, yoyo: true, ease: 'none' }, 3.2)
    .to(blender, { rotation: 0, duration: .2 }, 14.8)
  jar.forEach((piece, i) => {
    timeline.to(piece, { x: i % 2 ? -40 : 40, y: i % 2 ? 60 : -60, rotation: i % 2 ? -150 : 150, duration: .45, repeat: 25, yoyo: true, ease: 'sine.inOut' }, 3.1 + i * .1)
  })
  tokens.forEach((token, i) => {
    const at = 7 + i * .105
    const endX = (i % 6) / 5 * (bounds.width - (mobile ? 65 : 130))
    const endY = bounds.height * (.18 + ((i * 7) % 11) / 15)
    const apexY = Math.max(-100, mouth.y - (mobile ? 350 : 230) - i % 4 * 35)
    timeline.to(token, { autoAlpha: 1, scale: i >= 12 ? .8 : mobile ? .65 : 1, duration: .18 }, at)
      .to(token, { x: (mouth.x + endX) / 2, y: apexY, rotation: -80 + i * 23, duration: 1.1, ease: 'power2.out' }, at)
      .to(token, { x: endX, y: endY, rotation: -25 + i * 11, duration: 1.8, ease: 'power2.in' }, at + 1.1)
      .to(token, { y: endY + 12, rotation: -20 + i * 11, duration: .4, ease: 'power2.out' }, at + 2.9)
  })
  timeline.to(tokens, { autoAlpha: 0, y: '+=70', duration: 1.1, stagger: .035 }, 16)
    .to(ingredients, { x: 0, y: 0, rotation: i => i ? 12 : -14, scale: 1, autoAlpha: 1, duration: 1.4 }, 18)
    .to({}, { duration: 1.6 }, 19.4)
  return { timeline, still: 12, phases: [[0, 'ingredients'], [3.1, 'blend'], [7, 'splash'], [12, 'settle'], [18, 'reset']] }
}
