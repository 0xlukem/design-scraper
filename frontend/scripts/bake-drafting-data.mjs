import { renderLines } from '../src/components/letterpress/adana-lines.mjs'
import { pressPose } from '../src/components/letterpress/adana-model.mjs'

// Record visibility changes, not frames. The browser projects each physical
// part at its continuous position between these hidden-line samples.
export function bakeDraftingData(model, counts) {
  const phases = Object.keys(counts)
  const samples = Object.values(counts)
  const layers = ['outline', 'edge', 'detail', 'impression']
  const groups = [...new Set(model.map(solid => solid.group))]
  const points = [], pointIndex = new Map(), edges = [], edgeIndex = new Map()
  function vertex(group, xyz) {
    const coord = [group, ...xyz.map(x => Math.round(x * 100))]
    const key = coord.join(',')
    if (!pointIndex.has(key)) {
      pointIndex.set(key, points.length / 4)
      points.push(...coord)
    }
    return pointIndex.get(key)
  }
  for (const solid of model) {
    const group = groups.indexOf(solid.group)
    for (const edge of solid.edges) {
      edgeIndex.set(edge, edges.length)
      edges.push({ a: vertex(group, solid.verts[edge.i]), b: vertex(group, solid.verts[edge.j]), tracks: phases.map(() => []) })
    }
  }
  for (const [phase, count] of samples.entries()) {
    const modelPhase = ['explosion', 'pressure', 'delivery'].indexOf(phases[phase])
    const previous = new Map()
    for (let step = 0; step <= count; step++) {
      const args = [0, 0, 0]
      args[modelPhase] = step / count
      const rows = new Map()
      renderLines(model, pressPose(...args), (edge, layer, from, to) => {
        const id = edgeIndex.get(edge)
        if (!rows.has(id)) rows.set(id, [layers.indexOf(layer)])
        rows.get(id).push(Math.round(from * 1024), Math.round(to * 1024))
      })
      for (const id of new Set([...previous.keys(), ...rows.keys()])) {
        const row = rows.get(id) ?? []
        if (previous.get(id) === row.join(',')) continue
        edges[id].tracks[phase].push([step, ...row])
      }
      previous.clear()
      for (const [id, row] of rows) previous.set(id, row.join(','))
    }
  }
  const visible = edges.filter(edge => edge.tracks.some(track => track.length))
  const used = [...new Set(visible.flatMap(edge => [edge.a, edge.b]))]
  const renumber = new Map(used.map((id, i) => [id, i]))
  return {
    groups, phases, samples,
    points: used.flatMap(id => points.slice(id * 4, id * 4 + 4)),
    edges: visible.map(edge => [renumber.get(edge.a), renumber.get(edge.b), ...edge.tracks]),
  }
}
