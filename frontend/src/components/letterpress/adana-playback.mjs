export const durationMs = 10800
const ease = (p, start, end) => {
  const t = Math.min(1, Math.max(0, (p - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

export function studyFrame(p) {
  const explosion = ease(p, .025, .27) - ease(p, .40, .65)
  const pressure = ease(p, .70, .79) - ease(p, .82, .90)
  const delivery = ease(p, .905, .98)
  const ink = p >= .79
  const family = explosion > 0 || p < .65 ? 'explosion' : pressure > 0 ? 'pressure' : 'delivery'
  const value = family === 'explosion' ? explosion : family === 'pressure' ? pressure : delivery
  const phase = p >= .98 ? 'proof' : p >= .79 && p <= .82 ? 'contact' : p >= .65 && p <= .70 ? 'registered' :
    p >= .27 && p <= .40 ? 'exploded' : p < .025 ? 'ready' : 'moving'
  return { family, value, ink, phase, explosion, pressure, delivery }
}

export function viewBox(explosion) {
  return [-297-196*explosion, -406-131*explosion, 516+383*explosion, 494+131*explosion].map(n => n.toFixed(3)).join(' ')
}
