// A bounded 2D surface solver: double-density relaxation (Clavet et al., SCA 2005),
// pairwise viscosity, gravity, surface adhesion and drying. Not a 3D liquid solver.
// https://doi.org/10.2312/SCA/SCA05/219-228
export const STEP = 1 / 120;
export function randomSource(seed = 1) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export class PaintFluid {
  constructor({ radius = 4, viscosity = 8, gravity = 260, dryAfter = 5, seed = 1, floor = Infinity } = {}) {
    Object.assign(this, { radius, viscosity, gravity, dryAfter, floor });
    this.random = randomSource(seed); this.particles = []; this.film = []; this.age = 0; this.sleeping = false;
    this.steps = 0; this.collisions = 0; this.neighborPairs = 0;
  }
  impact({ x = 0, y = 0, vx = 0, vy = 0, count = 64, spread = 1 } = {}) {
    const r = this.random, radius = this.radius;
    // Equal-volume material parcels. Initial tangential speed comes from impact
    // momentum; uneven angles/thickness break symmetry without scripted silhouettes.
    const speed = Math.min(480, Math.hypot(vx, vy) * .36 + 65) * spread;
    const thicknessPhase = r() * Math.PI * 2, thicknessLobes = 2 + r() * 3;
    for (let i = 0; i < Math.min(count, 120); i++) {
      const a = i * 2.399963229728653 + (r() - .5) * .35;
      const d = Math.sqrt(i + .5) * radius * .68;
      const edge = Math.pow((i + 1) / count, 2), impulse = speed * edge * (.45 + r() * .9);
      this.particles.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        vx: Math.cos(a) * impulse + vx * .035, vy: Math.sin(a) * impulse + vy * .035,
        px: 0, py: 0, wetness: .35 + .5 * (1 + Math.sin(a * thicknessLobes + thicknessPhase)) / 2 + r() * .15, density: 0, anchor: null, depositedX: x + Math.cos(a) * d, depositedY: y + Math.sin(a) * d, deposits: 0 });
    }
    this.sleeping = false; this.age = 0;
  }
  step(dt = STEP) {
    if (this.sleeping) return;
    const ps = this.particles, h = this.radius * 4, dt2 = dt * dt;
    this.age += dt; this.steps++;
    const wet = Math.max(0, 1 - this.age / this.dryAfter);
    const grid = new Map();
    for (const p of ps) {
      p.px = p.x; p.py = p.y;
      // Thin film adheres quickly; thick wet material continues under gravity.
      const mobile = Math.max(0, p.wetness * wet - .16);
      p.vy += this.gravity * mobile * dt;
      if (this.age > .22 && !p.anchor && p.wetness < .72) p.anchor = { x: p.x, y: p.y };
      if (p.anchor) { p.vx += (p.anchor.x - p.x) * 180 * dt; p.vy += (p.anchor.y - p.y) * 180 * dt; }
      const drag = Math.exp(-(2 + (1 - mobile) * 7) * dt);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const key = `${Math.floor(p.x / h)},${Math.floor(p.y / h)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
    const pairs = [];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], gx = Math.floor(p.x / h), gy = Math.floor(p.y / h), ns = [];
      let density = 0, near = 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const q of grid.get(`${gx + ox},${gy + oy}`) || []) {
          if (p === q) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
          if (d < h && d > .001) { const w = 1 - d / h; density += w * w; near += w * w * w; ns.push([q, dx / d, dy / d, w]); }
        }
      }
      p.density = density;
      const pressure = 1100 * Math.max(-.3, density - 4.4), nearPressure = 2100 * near;
      let dx = 0, dy = 0;
      for (const [q, nx, ny, w] of ns) {
        const amount = dt2 * (pressure * w + nearPressure * w * w) * wet * .5;
        q.x += nx * amount; q.y += ny * amount; dx -= nx * amount; dy -= ny * amount;
        pairs.push([p, q, w]);
      }
      p.x += dx; p.y += dy;
    }
    for (const p of ps) {
      if (p.y > this.floor - this.radius) { p.y = this.floor - this.radius; this.collisions++; }
      p.vx = (p.x - p.px) / dt; p.vy = (p.y - p.py) / dt;
    }
    // Equal and opposite viscosity impulses preserve pair momentum.
    for (const [p, q, w] of pairs) {
      const a = Math.min(.12, this.viscosity * dt * w * .5), ix = (q.vx - p.vx) * a, iy = (q.vy - p.vy) * a;
      p.vx += ix; p.vy += iy; q.vx -= ix; q.vy -= iy;
    }
    // Moving wet parcels leave a thin adhered film along their actual trajectory.
    // This is deposition on a wall, not a tether drawn toward a preset endpoint.
    for (const p of ps) if (this.age > .2 && p.deposits < 60 && Math.hypot(p.x-p.depositedX,p.y-p.depositedY)>this.radius*.65) {
      this.film.push({x:p.x,y:p.y,r:this.radius*.65});
      p.depositedX=p.x;p.depositedY=p.y;p.deposits++;
    }
    this.neighborPairs = pairs.length;
    if (this.age >= this.dryAfter) { this.sleeping = true; for (const p of ps) p.vx = p.vy = 0; }
  }
  bounds(pad = this.radius * 3) {
    const all = [...this.particles, ...this.film], xs = all.map(p => p.x), ys = all.map(p => p.y);
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad };
  }
}

// Marching squares over a compact material-density field. Geometry comes from
// particles, not an animated drawing. Bounds always include kernel support.
export function fluidPath(fluid, cell = 3) {
  if (!fluid.particles.length) return '';
  const b = fluid.bounds(), r = fluid.radius * 2.65, cols = Math.ceil((b.right-b.x)/cell)+1, rows = Math.ceil((b.bottom-b.y)/cell)+1;
  const field = new Float32Array(cols * rows), cutoff = .65;
  for (const p of [...fluid.particles, ...fluid.film]) {
    const support = p.r ? p.r * 2.65 : r;
    const x0 = Math.max(0, Math.floor((p.x-support-b.x)/cell)), x1 = Math.min(cols-1, Math.ceil((p.x+support-b.x)/cell));
    const y0 = Math.max(0, Math.floor((p.y-support-b.y)/cell)), y1 = Math.min(rows-1, Math.ceil((p.y+support-b.y)/cell));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const d2=((b.x+x*cell-p.x)**2+(b.y+y*cell-p.y)**2)/(support*support);
      if(d2<1)field[y*cols+x]+=(1-d2)**2;
    }
  }
  const segments = [], cases = [[],[[3,0]],[[0,1]],[[3,1]],[[1,2]],[[3,2],[0,1]],[[0,2]],[[3,2]],[[2,3]],[[2,0]],[[0,3],[1,2]],[[2,1]],[[1,3]],[[1,0]],[[0,3]],[]];
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++) {
    const values=[field[y*cols+x],field[y*cols+x+1],field[(y+1)*cols+x+1],field[(y+1)*cols+x]];
    const mask=values.reduce((n,v,i)=>n|(v>cutoff?1<<i:0),0);
    const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]];
    const edge=e=>{const j=(e+1)%4,t=(cutoff-values[e])/(values[j]-values[e]);return [b.x+(corners[e][0]+(corners[j][0]-corners[e][0])*t)*cell,b.y+(corners[e][1]+(corners[j][1]-corners[e][1])*t)*cell]};
    for(const [a,c] of cases[mask])segments.push([edge(a),edge(c)]);
  }
  const key=p=>p.map(n=>n.toFixed(2)).join(','), links=new Map();
  segments.forEach((s,i)=>s.forEach((p,j)=>{const k=key(p);if(!links.has(k))links.set(k,[]);links.get(k).push([i,j])}));
  const used=new Set(), paths=[];
  for(let i=0;i<segments.length;i++){
    if(used.has(i))continue;
    const points=[segments[i][0]], first=key(points[0]);let index=i,end=1;
    for(let guard=0;guard<=segments.length;guard++){
      used.add(index);const p=segments[index][end];points.push(p);if(key(p)===first)break;
      const next=(links.get(key(p))||[]).find(([id])=>!used.has(id));if(!next)break;[index,end]=next;end=1-end;
    }
    if(points.length>3)paths.push('M'+points.map(p=>p.map(n=>n.toFixed(1)).join(' ')).join('L')+'Z');
  }
  return paths.join('');
}
