import { project } from './adana-lines.mjs'
import { pressPose } from './adana-model.mjs'

const empty = []
const basis = [[0,0,0],[1,0,0],[0,1,0],[0,0,1]]

// Find the most recent change in the visibility of this particular edge.
function atSample(track, tick) {
  let lo = 0, hi = track.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (track[mid][0] <= tick) lo = mid + 1
    else hi = mid
  }
  return lo ? track[lo - 1] : empty
}

// Pair the visible subsegments of an edge. When an opening splits a stroke,
// the shorter list is partitioned by visible length so no line spans the cut.
function runs(row) {
  const parts = []
  let length = 0
  for (let i = 2; i < row.length; i += 2) {
    const size = row[i + 1] - row[i]
    if (size > 0) {
      parts.push({ start: row[i], end: row[i + 1], before: length, size })
      length += size
    }
  }
  for (const p of parts) { p.from = p.before / length; p.to = (p.before + p.size) / length }
  return parts
}

function pairRuns(left, right) {
  const a = runs(left), b = runs(right)
  const spans = []
  if (!a.length || !b.length) {
    for (const r of a.length ? a : b) {
      const mid = (r.start + r.end) / 2
      spans.push(a.length ? [r.start,r.end,mid,mid] : [mid,mid,r.start,r.end])
    }
    return spans
  }
  if (a.length === b.length) return a.map((r, i) => [r.start,r.end,b[i].start,b[i].end])
  const lerp = (r,t) => r.start + r.size * (t-r.from) / (r.to-r.from)
  for (const first of a) for (const second of b) {
    const lo = Math.max(first.from,second.from), hi = Math.min(first.to,second.to)
    if (hi > lo) spans.push([lerp(first,lo),lerp(first,hi),lerp(second,lo),lerp(second,hi)])
  }
  return spans
}

export function createDraftingRenderer(data) {
  const coordinates = new Float64Array(data.points.length / 2)
  let cachedPhase = -1, cachedStep = -1, active = []
  function select(phase, step) {
    if (cachedPhase === phase && cachedStep === step) return
    const next = []
    for (const edge of data.edges) {
      const track = edge[2 + phase]
      const a = atSample(track,step), b = atSample(track,step+1)
      if (a.length <= 2 && b.length <= 2) continue
      for (const [u,v,U,V] of pairRuns(a,b)) {
        next.push([edge[0]*2,edge[1]*2,a[1]??b[1],u/1024,v/1024,(U-u)/1024,(V-v)/1024])
      }
    }
    active = next
    cachedPhase = phase
    cachedStep = step
  }
  return frame => {
    const phase = data.phases.indexOf(frame.family)
    const unit = frame.value * data.samples[phase]
    const step = Math.floor(unit)
    const blend = unit - step
    select(phase,step)
    const pose = pressPose(frame.explosion,frame.pressure,frame.delivery)
    // Projection of any rigid part is affine. Four basis points per assembly
    // suffice for all its vertices, including both rotations of the printed card.
    const matrices = data.groups.map(group => {
      const [o,x,y,z] = basis.map(p => project(pose.transforms[group](p)))
      return [o[0]*10,o[1]*10,(x[0]-o[0])*.1,(y[0]-o[0])*.1,(z[0]-o[0])*.1,
        (x[1]-o[1])*.1,(y[1]-o[1])*.1,(z[1]-o[1])*.1]
    })
    for (let i = 0, j = 0; i < data.points.length; i += 4) {
      const m = matrices[data.points[i]]
      const x = data.points[i+1], y = data.points[i+2], z = data.points[i+3]
      coordinates[j++] = m[0] + m[2]*x + m[3]*y + m[4]*z
      coordinates[j++] = m[1] + m[5]*x + m[6]*y + m[7]*z
    }
    const layers = [[], [], [], []]
    for (const [a,b,layer,u0,v0,du,dv] of active) {
      const u = u0+du*blend, v = v0+dv*blend
      if (v-u < .0002) continue
      const x = coordinates[a], y = coordinates[a+1]
      const dx = coordinates[b]-x, dy = coordinates[b+1]-y
      layers[layer].push('M'+Math.round(x+u*dx)+' '+Math.round(y+u*dy)+'L'+Math.round(x+v*dx)+' '+Math.round(y+v*dy))
    }
    return { paths: layers.map(parts => parts.join('')), platen: pose.platen, handle: pose.handle }
  }
}
