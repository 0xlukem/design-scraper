import { animate } from 'framer-motion'

type Reveal = {
  node: HTMLElement
  content: HTMLElement[]
  inView: boolean
  done: boolean
  delay: number
  generation: number
  animation?: ReturnType<typeof animate>
}

/** A horizontal wipe exposes each export's actual text in reading order. */
export function mountExportReveal(root: HTMLElement): () => void {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = media.matches
  let disposed = false
  const closed = 'inset(0% 100% 0% 0%)'
  const items: Reveal[] = [...root.querySelectorAll<HTMLElement>('.exports-heading, .export-list > div')].map((node, index) => ({
    node,
    content: [...node.children] as HTMLElement[],
    inView: false,
    done: false,
    delay: index * .1,
    generation: 0,
  }))

  const reset = (item: Reveal) => {
    item.generation++
    item.animation?.stop()
    item.animation = undefined
    item.done = reduced
    item.node.dataset.reveal = reduced ? 'still' : 'waiting'
    item.content.forEach(element => {
      element.style.clipPath = reduced ? '' : closed
      element.style.willChange = ''
    })
  }
  const sync = (item: Reveal) => {
    if (disposed || reduced || item.done) return
    if (!item.inView || document.hidden) {
      item.animation?.pause()
      return
    }
    if (item.animation) {
      item.animation.play()
      return
    }
    const generation = item.generation
    item.node.dataset.reveal = 'revealing'
    item.content.forEach(element => { element.style.willChange = 'clip-path' })
    item.animation = animate(0, 1, {
      duration: .72,
      delay: item.delay,
      ease: [.22, 1, .36, 1],
      onUpdate: progress => {
        if (disposed || generation !== item.generation) return
        const mask = `inset(0% ${(1 - progress) * 100}% 0% 0%)`
        item.content.forEach(element => { element.style.clipPath = mask })
      },
      onComplete: () => {
        if (disposed || generation !== item.generation) return
        item.done = true
        item.node.dataset.reveal = 'visible'
        item.content.forEach(element => {
          element.style.clipPath = ''
          element.style.willChange = ''
        })
      },
    })
  }
  items.forEach(reset)
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const item = items.find(candidate => candidate.node === entry.target)!
      item.inView = entry.isIntersecting && entry.intersectionRatio >= .18
      if (!entry.isIntersecting) reset(item)
      sync(item)
    }
  }, { threshold: [0, .18] })
  items.forEach(item => observer.observe(item.node))
  const preference = (event: MediaQueryListEvent) => {
    reduced = event.matches
    items.forEach(item => { reset(item); sync(item) })
  }
  const visibility = () => items.forEach(sync)
  media.addEventListener('change', preference)
  document.addEventListener('visibilitychange', visibility)
  return () => {
    disposed = true
    observer.disconnect()
    media.removeEventListener('change', preference)
    document.removeEventListener('visibilitychange', visibility)
    items.forEach(item => {
      item.animation?.stop()
      item.content.forEach(element => {
        element.style.clipPath = ''
        element.style.willChange = ''
      })
    })
  }
}
