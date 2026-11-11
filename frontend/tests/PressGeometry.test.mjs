import { describe, expect, it } from 'vitest'
import { engraving, prism, project, renderLines } from '../src/components/letterpress/adana-lines.mjs'
import { bedPoint, hinge, linkage, pressPose } from '../src/components/letterpress/adana-model.mjs'

// A calibration block with a mark embedded in its centre distinguishes the near
// surfaces from the far ones, even when the two silhouettes look identical.
const block = prism('block', [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], [0, 0, 10])
const pose = { transforms: {} }
const mark = (from, to) => engraving('mark', [from, to], 'detail')
const detail = (line) => renderLines([block, line], pose).detail

describe('press drawing', () => {
  it('hides a buried mark and preserves an engraving on the top face', () => {
    expect(detail(mark([3, 5, 5], [7, 5, 5]))).toBe('')
    const engravingOnTop = mark([3, 5, 10], [7, 5, 10])
    expect(detail(engravingOnTop)).not.toBe('')
    expect(detail(engravingOnTop)).toBe(renderLines([engravingOnTop], pose).detail)
  })

  it('reveals a shaft from the point it exits the casting', () => {
    const visible = detail(mark([3, 5, 5], [14, 5, 5]))
    const numbers = visible.match(/-?[\d.]+/g)?.map(Number)
    expect(numbers).toHaveLength(4)
    const expected = [...project([10, 5, 5]).slice(0, 2), ...project([14, 5, 5]).slice(0, 2)]
    // Paths are rounded to hundredths; the renderer allows a small coplanar tolerance.
    expected.forEach((value, i) => expect(Math.abs(numbers[i] - value)).toBeLessThan(0.08))
  })

  it('keeps both ends of the impression link seated throughout the lever stroke', () => {
    const open = linkage(0)
    const dist = (p, q) => Math.hypot(...p.map((value, i) => value - q[i]))
    for (let i = 0; i <= 180; i++) {
      const { transforms } = pressPose(0, i / 180, 0)
      const crankPin = [135, ...open.pin], platenPin = [135, ...open.joint]
      expect(dist(transforms.link(crankPin), transforms.drive(crankPin))).toBeLessThan(.001)
      expect(dist(transforms.link(platenPin), transforms.platen(platenPin))).toBeLessThan(.001)
    }
  })

  it('brings the entire paper face into register with the type at impression', () => {
    const a = linkage(0).platen * Math.PI / 180
    const corners = [[-84, 17], [84, 17], [84, 122], [-84, 122]]
    for (const [x, t] of corners) {
      const paper = [x, hinge[0] + t * Math.sin(a) - 8 * Math.cos(a), hinge[1] + t * Math.cos(a) + 8 * Math.sin(a)]
      const type = bedPoint(x, t, -8)
      const gap = (pressure) => Math.hypot(...pressPose(0, pressure, 0).transforms.paper(paper).map((value, i) => value - type[i]))
      expect(gap(0)).toBeGreaterThan(1)
      expect(gap(1)).toBeLessThan(.001)
    }
  })
})
