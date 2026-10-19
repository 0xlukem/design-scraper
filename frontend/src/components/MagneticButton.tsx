import {
  type HTMLMotionProps,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion'
import type { PointerEvent, ReactNode } from 'react'

interface MagneticButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode
  tone?: 'ink' | 'accent' | 'acid'
}

const toneClasses = {
  ink: 'bg-[var(--ink)] text-[var(--paper)]',
  accent: 'bg-[var(--accent)] text-[var(--paper)]',
  acid: 'bg-[var(--acid)] text-[var(--ink)]',
}

export default function MagneticButton({
  children,
  className = '',
  tone = 'ink',
  disabled,
  onPointerMove,
  onPointerLeave,
  ...props
}: MagneticButtonProps) {
  const reduceMotion = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 100, damping: 20 })
  const springY = useSpring(y, { stiffness: 100, damping: 20 })

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event)
    if (
      reduceMotion ||
      event.currentTarget.closest('[data-motion="paused"]') ||
      window.matchMedia('(pointer: coarse)').matches ||
      disabled
    ) {
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    x.set((event.clientX - bounds.left - bounds.width / 2) * 0.12)
    y.set((event.clientY - bounds.top - bounds.height / 2) * 0.12)
  }

  const handlePointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event)
    x.set(0)
    y.set(0)
  }

  return (
    <motion.button
      layout
      style={{ x: springX, y: springY }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      disabled={disabled}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`action-button ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
