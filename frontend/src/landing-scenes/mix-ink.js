import { createLedgePool } from './paint-ledge.js';
import { PaintFluid, STEP, fluidPath, randomSource } from './paint-fluid.mjs';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#f24cad', '#edff7a', '#287df1'];
const node = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
};
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// One page-wide material surface. Flights and deposits use the same coordinates;
// grid columns and responsive section boundaries never become clipping planes.
export function createMixInk({ banner, host, stamps = [], title = banner.querySelector('#mix-title') }) {
  const surface = banner.closest('.experience-shell') || banner;
  const workspace = banner.classList.contains('mix-workspace');
  const originalLabel = title.getAttribute('aria-label'), replacements = [], letters = [];
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT), texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim());
  for (const text of texts) {
    const fragment = document.createDocumentFragment();
    for (const word of text.textContent.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) { fragment.append(document.createTextNode(word)); continue; }
      const span = document.createElement('span'); span.className = 'mix-word'; span.setAttribute('aria-hidden', 'true');
      for (const character of word) {
        const glyph = document.createElement('span'); glyph.className = 'mix-letter'; glyph.textContent = character;
        span.append(glyph); letters.push({ node: glyph, box: null });
      }
      fragment.append(span);
    }
    const marker = document.createComment('paint text'), inserted = [...fragment.childNodes];
    text.replaceWith(marker, fragment); replacements.push({ text, marker, inserted });
  }
  const wall = node('svg', { 'aria-hidden': 'true' }), air = node('svg', { 'aria-hidden': 'true' });
  wall.classList.add('mix-stains'); air.classList.add('mix-ink-air'); surface.append(wall, air);
  let box, hostBox, shots = [], patches = [], serial = 0, clock = 0, nextShot = .35;
  let lastMs = null, accumulator = 0, lastPaint = -1, impacts = 0, disposed = false;
  let random = randomSource(1207), sourcePoint = { x: 0, y: 0 }, letterHits = 0, wallHits = 0;
  const relative = rect => ({ x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height });
  const form = banner.querySelector('.reference-box') || banner;
  const endBanner = surface.querySelector('.mix-banner');
  const footer = surface.querySelector('.drawing-footer');
  const results = surface.querySelector('.analysis-results');
  // A blurred alpha edge acts as a shallow height field. Lighting follows the
  // actual silhouette (including each hanging bead), in local patch bounds.
  const relief = node('filter', { id: 'mix-wall-paint-relief', 'color-interpolation-filters': 'sRGB' });
  const light = node('feSpecularLighting', { surfaceScale: 3.2, specularConstant: .37, specularExponent: 15, 'lighting-color': '#fffbf0' });
  light.append(node('feDistantLight', { azimuth: 232, elevation: 44 }));
  relief.append(node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 2.1 }), light,
    node('feComposite', { in2: 'SourceAlpha', operator: 'in', result: 'rim' }),
    node('feComposite', { in: 'SourceGraphic', in2: 'rim', operator: 'arithmetic', k2: 1, k3: 1 }));
  const defs = node('defs');
  defs.append(relief);
  const upperWall = endBanner && node('svg', { x: 0, y: 0, width: '100%', overflow: 'hidden' });
  const world = banner.querySelector('.mix-world') || banner;
  const pageScale = () => Math.max(1, Math.min(1.8, box.width / 1440));
  const titleTarget = (fraction, large = false) => ({ element: letters[Math.floor(fraction * (letters.length - 1))].node, u: .5, v: .5, title: true, large });
  const wallTarget = (element, u, v, large = false, offset = 0) => ({ element, u, v, large, offset });
  const ledgePositions = [.28, .77, .51];
  const pools = new Map();
  const floorPieces = [];
  let ledgeShots = 0, launchedPieces = 0, lipHeight = 0;
  function positionPiece(piece) {
    const { x, y } = targetPoint(piece.target);
    const scale = ledgeScale();
    piece.group.setAttribute('transform', `translate(${x} ${y - piece.target.lift * scale}) scale(${scale})`);
  }
  const ledgeScale = () => Math.max(.62, Math.min(pageScale(), box.width / 900));
  function positionPool(pool) {
    const lip = relative(endBanner.getBoundingClientRect());
    const heading = endBanner.querySelector('h2').getBoundingClientRect();
    const clearance = Math.max(1, heading.top - endBanner.getBoundingClientRect().top - 5);
    pool.group.setAttribute('transform', `translate(${lip.x + pool.u * lip.width} ${lip.y}) scale(${ledgeScale()} ${Math.min(ledgeScale(), clearance / 36)})`);
  }
  function depositOnLedge(key, u, color, offset, load) {
    let pool = pools.get(key);
    if (!pool) {
      pool = createLedgePool(node, color, randomSource(809 + 947 * pools.size));
      pool.u = u;
      pools.set(key, pool);
      wall.append(pool.group);
      positionPool(pool);
    }
    pool.add(offset, load);
  }
  // The former fixed splashes now arrive as the first, heaviest paint loads.
  // Offscreen targets wait until their region enters the viewport.
  const openingTargets = () => workspace ? [
    ...(innerWidth > 2200 ? [
      { ...wallTarget(banner, 0, .14, true), pageX: .24, minWidth: 2201 },
      { ...wallTarget(banner, 0, .08, true), pageX: .72, minWidth: 2201 },
      { ...wallTarget(banner, 0, .45, true), pageX: .08, minWidth: 2201 },
      { ...wallTarget(banner, 0, .74, true), pageX: .91, minWidth: 2201 },
    ] : []),
    wallTarget(form, .20, .17, true), titleTarget(.12, true),
    wallTarget(form, .72, .38, true),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .18, .22, true), minWidth: 901 }] : []),
    titleTarget(.53, true), wallTarget(form, .91, .58, true),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .76, .21, true), minWidth: 901 }] : []),
    titleTarget(.88, true), wallTarget(form, .29, .74, true),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .1, .7, true), minWidth: 901 }] : []),
    titleTarget(.32, true), wallTarget(world, .88, .65, true),
    wallTarget(form, .57, .89, true),
    ...(results ? [[.12, .12], [.68, .26], [.42, .49], [.89, .61], [.19, .77]].map(([u, v]) =>
      ({ ...wallTarget(results, u, v, true), panel: true })) : []),
    ...(innerWidth > 1800 ? [{ ...wallTarget(form, 0, .28, true), pageX: .15, minWidth: 1801 }, { ...wallTarget(form, 0, .6, true), pageX: .85, minWidth: 1801 }] : []),
    ...(endBanner ? [wallTarget(endBanner, 0, .05, true, -35), wallTarget(endBanner, 1, .05, true, 35)] : []),
    ...(footer ? [wallTarget(footer, 1, .8, true, 25)] : []),
  ] : [];
  let pending = openingTargets();
  function targetPoint(target) {
    const bounds = relative(target.element.getBoundingClientRect());
    const offset = target.offsetUnits === undefined ? target.offset || 0 : target.offsetUnits * ledgeScale();
    const x = target.pageX === undefined ? bounds.x + bounds.width * target.u + offset : target.pageX * box.width;
    const height = target.panel ? Math.min(bounds.height, innerHeight) : bounds.height;
    return { x, y: bounds.y + height * target.v };
  }
  function isVisible(target) {
    if (target.element.hidden) return false;
    const point = targetPoint(target), y = point.y + box.top;
    return y > 70 && y < innerHeight - 30;
  }
  function resize() {
    box = surface.getBoundingClientRect(); hostBox = host.getBoundingClientRect();
    for (const el of [wall, air]) el.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    if (upperWall) {
      lipHeight = relative(endBanner.getBoundingClientRect()).y;
      upperWall.setAttribute('height', lipHeight);
    }
    for (const letter of letters) letter.box = relative(letter.node.getBoundingClientRect());
    // Existing stains remain anchored to their actual content across reflow.
    for (const patch of patches) positionPatch(patch);
    floorPieces.forEach(positionPiece);
    for (const pool of pools.values()) positionPool(pool);
    paintLetters();
  }
  function chooseTarget(i) {
    // Home keeps its smaller, earlier cadence and its own text/action keepouts.
    if (!workspace) {
      if (i % 3 !== 2) return titleTarget(((i * 7) % letters.length) / Math.max(1, letters.length - 1));
      const margin = box.width < 760 ? 18 : 65;
      const keepouts = [title, ...banner.querySelectorAll('.mix-wordmark,.mix-description,.mix-actions')].map(el => relative(el.getBoundingClientRect()));
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = margin + random() * (box.width - margin * 2), y = 80 + random() * Math.max(20, box.height - 230);
        if (!keepouts.some(b => overlaps({ x: x - margin, y: y - margin, width: margin * 2, height: margin * 2 + 100 }, b))) return wallTarget(banner, x / box.width, y / box.height);
      }
      return wallTarget(banner, .97, .4);
    }
    if (endBanner && stamps.length && launchedPieces < 9 && i % 5 === 3) {
      const number = launchedPieces++;
      const pile = number % 3, layer = Math.floor(number / 3);
      const u = [.17, .81, .58][pile];
      const lift = [0, 1, 5][layer];
      return { ...wallTarget(endBanner, u, 0), stamp: stamps[(pile + layer) % stamps.length],
        offsetUnits: [0, 21, 8][layer] * (pile === 1 ? -1 : 1), lift };
    }
    // Some loads always land on the floor, even while it is below the viewport.
    // When the lip is on screen we can see successive loads feeding the same pool.
    if (endBanner && (i % 5 === 2 || (i % 4 === 1 && isVisible(wallTarget(endBanner, .5, 0))))) {
      const index = ledgeShots++ % ledgePositions.length;
      const offset = (random() - .5) * 17;
      return { ...wallTarget(endBanner, ledgePositions[index], 0, false, offset * ledgeScale()), poolIndex: index, poolOffset: offset };
    }
    const index = pending.findIndex(isVisible);
    if (index >= 0) return pending.splice(index, 1)[0];
    if (isVisible(titleTarget(.5)) && i % 4 === 0) return titleTarget(random());
    // Distribute over the available surface, rather than drawing two edge rails.
    // Prefer unpainted gaps; text and the opaque center of the blender stay clear.
    const protect = [title, banner.querySelector('.analysis-description')].filter(Boolean).map(el => relative(el.getBoundingClientRect()));
    const resultBox = results && !results.hidden ? relative(results.getBoundingClientRect()) : null;
    const model = relative(world.getBoundingClientRect());
    if (box.width > 900) protect.push({ x: model.x + model.width * .34, y: model.y + model.height * .25, width: model.width * .37, height: model.height * .71 });
    let best = null, bestDistance = -1;
    for (let attempt = 0; attempt < 18; attempt++) {
      const y = Math.max(100, Math.min(box.height - 70, -box.top + 120 + random() * Math.max(60, innerHeight - 240)));
      const lowerPage = endBanner && y > relative(endBanner.getBoundingClientRect()).y - 50;
      const behindResults = resultBox && y >= resultBox.y && y <= resultBox.y + resultBox.height;
      const side = behindResults ? (resultBox.x + resultBox.width * (.06 + random() * .88)) / box.width : lowerPage ? (i % 2 ? -30 / box.width : 1 + 30 / box.width) : box.width <= 900 ? (i % 2 ? .015 + random() * .045 : .94 + random() * .045) : .025 + random() * .95;
      const x = side * box.width, pad = 65 * pageScale();
      if (protect.some(b => overlaps({ x: x - pad, y: y - pad, width: pad * 2, height: pad * 2 + 100 * pageScale() }, b))) continue;
      const distance = Math.min(...patches.filter(p => !p.target.title).map(p => Math.hypot(x - p.x, y - p.y)), box.width);
      if (distance > bestDistance) { best = { y, side }; bestDistance = distance; }
    }
    const { y, side } = best || { y: -box.top + innerHeight * .65, side: i % 2 ? .02 : .98 };
    // Anchor deposits to their section, so adding results below the hero cannot
    // stretch or move already-settled paint elsewhere on the page.
    const sections = [banner, results, endBanner, footer].filter(Boolean);
    const section = sections.find(element => { const b = relative(element.getBoundingClientRect()); return y >= b.y && y <= b.y + b.height; }) || banner;
    const region = relative(section.getBoundingClientRect());
    return { ...wallTarget(section, 0, (y - region.y) / Math.max(1, region.height)), pageX: side };
  }
  function emit() {
    const id = serial++, target = chooseTarget(id), point = targetPoint(target);
    const duration = target.large ? .62 + random() * .16 : .7 + random() * .3;
    const color = COLORS[(target.poolIndex ?? id) % COLORS.length], g = 620;
    const group = node('g', { fill: color, 'data-load': target.large ? 'large' : 'small' });
    const size = (target.large ? 2.6 : 1) * (workspace ? pageScale() : 1);
    if (target.stamp) {
      const { url, width, height } = target.stamp;
      group.append(node('image', { href: url, x: -width / 2, y: -height, width, height }));
    } else {
      group.append(node('ellipse', { rx: 3.5 * size, ry: 9 * size }), node('ellipse', { cx: -.7 * size, cy: -2 * size, rx: .8 * size, ry: 3 * size, fill: '#fff', opacity: .55 }));
    }
    air.append(group);
    shots.push({ x: sourcePoint.x, y: sourcePoint.y, z: 120, vx: (point.x - sourcePoint.x) / duration, vy: (point.y - sourcePoint.y - .5 * g * duration ** 2) / duration, vz: -120 / duration, g, target, color, id, group });
  }
  function radiusFor(target) {
    const small = box.width < 760, letterHeight = letters[0].box.height;
    const lower = target.element === endBanner || target.element === footer;
    if (!workspace) return target.title ? Math.max(1.2, Math.min(3.2, letterHeight * .042)) : small ? 2.4 : 4;
    if (target.title) return Math.max(2.4, Math.min(7.5, letterHeight * (target.large ? .085 : .045)));
    return target.large ? Math.max(4.5, Math.min(lower ? 5 : 9 * pageScale(), box.width / 135)) : small ? 2.4 : 3.5 * pageScale();
  }
  function collide(shot) {
    const target = shot.target;
    if (target.stamp) {
      floorPieces.push(shot);
      shot.group.dataset.region = 'floor-piece';
      wall.append(shot.group);
      positionPiece(shot);
      return;
    }
    if (target.poolIndex !== undefined) {
      depositOnLedge(target.poolIndex, target.u, shot.color, target.poolOffset, 1 + Math.min(.6, Math.abs(shot.vy) / 1200));
      wallHits++; impacts++;
      return;
    }
    const radius = radiusFor(target);
    const fluid = new PaintFluid({ radius, gravity: target.title ? 65 : 260 * (workspace ? pageScale() : 1), dryAfter: target.title ? 2.3 : 5.2, seed: shot.id + 900 });
    fluid.impact({ vx: shot.vx, vy: shot.vy, count: !workspace ? (target.title ? 32 : 58) : target.large ? 72 : 42, spread: target.title ? .32 : .8 });
    const path = node('path', { fill: shot.color, 'data-load': target.large ? 'large' : 'small', 'data-region': target.title ? 'title' : target.element === endBanner ? 'banner' : target.element === footer ? 'footer' : target.element === results ? 'results' : target.element === form ? 'form' : 'page' });
    const patch = { fluid, path, radius, scale: 1, color: shot.color, target, lastD: '', id: shot.id };
    if (target.title) letterHits++;
    else {
      wallHits++;
      patch.group = node('g');
      if (workspace) {
        if (!defs.isConnected) wall.prepend(defs);
        path.setAttribute('filter', 'url(#mix-wall-paint-relief)');
      }
      patch.sheen = node('path', { fill: 'none', stroke: '#fff', 'stroke-width': radius * .24, 'stroke-linecap': 'round' });
      patch.group.append(path, patch.sheen);
      if (upperWall && target.element !== results && target.element !== endBanner && target.element !== footer) {
        if (!upperWall.isConnected) wall.prepend(upperWall);
        upperWall.append(patch.group);
      } else wall.append(patch.group);
    }
    patches.push(patch); impacts++; positionPatch(patch);
    // Keep entrance loads; recycle only small later deposits. Bounded DOM/solvers.
    while (patches.length > Math.round(44 * (workspace ? pageScale() : 1))) {
      const index = patches.findIndex(p => !p.target.large && !p.fluid);
      if (index < 0) break;
      patches[index].group?.remove(); patches.splice(index, 1);
    }
  }
  function positionPatch(patch) {
    Object.assign(patch, targetPoint(patch.target));
    patch.scale = radiusFor(patch.target) / patch.radius;
    (patch.group || patch.path).setAttribute('transform', `translate(${patch.x} ${patch.y}) scale(${patch.scale})`);
    const incompatible = patch.target.minWidth && box.width < patch.target.minWidth;
    // A stain that belonged in a wide-layout gap must not move over the headline
    // after reflow. Hide that whole deposit instead of clipping its silhouette.
    let readingOverlap = false;
    if (workspace && !patch.target.title && patch.bounds) {
      const paint = { x: patch.x + patch.bounds.x * patch.scale, y: patch.y + patch.bounds.y * patch.scale,
        width: (patch.bounds.right - patch.bounds.x) * patch.scale, height: (patch.bounds.bottom - patch.bounds.y) * patch.scale };
      readingOverlap = [title, banner.querySelector('.analysis-description')].filter(Boolean).some(el => overlaps(paint, relative(el.getBoundingClientRect())));
    }
    (patch.group || patch.path).style.visibility = incompatible || readingOverlap ? 'hidden' : '';

  }
  function paintLetters() {
    for (const letter of letters) {
      const entries = patches.filter(p => p.target.title && p.lastD && overlaps(letter.box, {
        x: p.x + p.bounds.x * p.scale, y: p.y + p.bounds.y * p.scale, width: (p.bounds.right - p.bounds.x) * p.scale, height: (p.bounds.bottom - p.bounds.y) * p.scale,
      })).reverse();
      letter.node.classList.toggle('is-inked', entries.length > 0);
      letter.node.style.backgroundImage = entries.map(p => p.image).join(',');
      letter.node.style.backgroundSize = entries.map(p => `${(p.bounds.right - p.bounds.x) * p.scale}px ${(p.bounds.bottom - p.bounds.y) * p.scale}px`).join(',');
      letter.node.style.backgroundPosition = entries.map(p => `${p.x - letter.box.x + p.bounds.x * p.scale}px ${p.y - letter.box.y + p.bounds.y * p.scale}px`).join(',');
    }
  }
  function advanceFlights(dt) {
    clock += dt;
    if (clock >= nextShot) {
      // Never launch more material while the previous impacts saturate the solver.
      if (patches.filter(p => p.fluid).length < 7) emit();
      nextShot = clock + (!workspace ? (serial < 6 ? .52 : 1.25) : pending.some(isVisible) ? .42 : 1.8 / pageScale());
    }
    for (const shot of shots) {
      const remaining = shot.z / -shot.vz;
      const travel = Math.min(dt, remaining);
      shot.x += shot.vx * travel;
      shot.y += shot.vy * travel + .5 * shot.g * travel ** 2;
      shot.vy += shot.g * travel;
      shot.z = dt >= remaining ? 0 : shot.z + shot.vz * travel;
      if (shot.z === 0) { shot.group.remove(); collide(shot); }
    }
    shots = shots.filter(shot => shot.z > 0);
  }
  function draw() {
    for (const shot of shots) {
      const scale = .6 + (1 - shot.z / 120) * .75, angle = Math.atan2(shot.vy, shot.vx) * 180 / Math.PI - 90;
      if (shot.target.stamp) {
        const remaining = Math.max(0, shot.z / 120);
        const spin = remaining * remaining * (shot.id % 2 ? 250 : -250);
        shot.group.setAttribute('transform', `translate(${shot.x} ${shot.y - shot.target.lift * ledgeScale()}) scale(${ledgeScale()}) rotate(${spin})`);
        continue;
      }
      shot.group.setAttribute('transform', `translate(${shot.x.toFixed(2)} ${shot.y.toFixed(2)}) rotate(${angle.toFixed(1)}) scale(${scale.toFixed(2)})`);
    }
    if (clock - lastPaint < 1 / 30) return;
    const dt = clock - lastPaint;
    for (const pool of pools.values()) pool.draw(dt);
    lastPaint = clock; let titleChanged = false;
    for (const patch of patches) if (patch.fluid) {
      patch.lastD = fluidPath(patch.fluid, Math.max(2, patch.fluid.radius * .65)); patch.bounds = patch.fluid.bounds();
      patch.path.setAttribute('d', patch.lastD);
      if (patch.sheen) {
        const fluid = patch.fluid;
        if (upperWall && patch.group.parentNode === upperWall && patch.y + patch.bounds.bottom * patch.scale >= lipHeight) {
          const landed = fluid.particles.filter(p => !p.landed && patch.y + p.y * patch.scale >= lipHeight);
          if (landed.length) {
            const x = patch.x + landed.reduce((sum, p) => sum + p.x, 0) * patch.scale / landed.length;
            const u = Math.max(0, Math.min(1, x / box.width));
            // Nearby runoff of the same pigment feeds one persistent puddle.
            const key = `runoff-${patch.color}-${Math.round(u * 12)}`;
            depositOnLedge(key, u, patch.color, 0, landed.length * .095);
            for (const p of landed) p.landed = true;
          }
        }
        const tip = fluid.particles.reduce((lowest, p) => p.y > lowest.y ? p : lowest);
        const r = patch.radius * Math.cbrt(tip.volume);
        patch.sheen.setAttribute('d', `M ${tip.x - r * .5} ${tip.y - r * .65} q ${-r * .34} ${r * .6} ${-r * .12} ${r * 1.07}`);
        patch.sheen.setAttribute('opacity', String(.36 * Math.max(0, 1 - fluid.age / fluid.dryAfter)));
      }
      if (patch.target.title) {
        patch.image = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="${NS}" viewBox="${patch.bounds.x} ${patch.bounds.y} ${patch.bounds.right - patch.bounds.x} ${patch.bounds.bottom - patch.bounds.y}"><path fill="${patch.color}" d="${patch.lastD}"/></svg>`)}")`;
        titleChanged = true;
      }
      if (patch.fluid.sleeping) patch.fluid = null;
    }
    if (titleChanged) paintLetters();
    banner.dataset.inkMarks = String(impacts); banner.dataset.inkLetters = String(letterHits); banner.dataset.inkBackground = String(wallHits);
    banner.dataset.paintParticles = String(patches.reduce((count, patch) => count + (patch.fluid?.particles.length || 0), 0));
    banner.dataset.paintFlights = String(shots.length); banner.dataset.paintEngine = 'surface-fluid';
  }
  function render(ms, source, { still = false } = {}) {
    if (disposed) return;
    // Scrolling changes viewport coordinates without changing local geometry.
    box = surface.getBoundingClientRect(); hostBox = host.getBoundingClientRect();
    sourcePoint = { x: hostBox.left - box.left + (source.x + 1) * hostBox.width / 2, y: hostBox.top - box.top + (1 - source.y) * hostBox.height / 2 };
    if (still) {
      // Mix It stays clean with reduced motion; Home retains its still artwork.
      if (!workspace && !impacts) {
        for (let i = 0; i < 3; i++) collide({ target: chooseTarget(i), vx: 0, vy: 250, color: COLORS[i], id: i });
        for (const patch of patches) while (!patch.fluid.sleeping) patch.fluid.step();
        clock += 1; draw();
      }
      lastMs = ms; return;
    }
    if (lastMs === null) lastMs = ms;
    const dt = Math.min(.5, Math.max(0, (ms - lastMs) / 1000));
    lastMs = ms;
    // Flights are analytic. Only the iterative surface solver needs a catch-up
    // budget; a slow WebGL frame must not make objects hang in midair.
    advanceFlights(dt);
    accumulator += Math.min(.08, dt);
    while (accumulator >= STEP) {
      for (const patch of patches) patch.fluid?.step();
      accumulator -= STEP;
    }
    draw();
  }
  function reset() {
    shots.forEach(shot => shot.group.remove()); shots = []; patches = []; pools.clear(); floorPieces.length = 0; launchedPieces = 0; ledgeShots = 0; wall.replaceChildren(); upperWall?.replaceChildren();
    clock = 0; nextShot = .35; serial = 0; impacts = 0; letterHits = 0; wallHits = 0;
    random = randomSource(1207); lastMs = null; accumulator = 0; lastPaint = -1; pending = openingTargets(); paintLetters();
  }
  const observer = new ResizeObserver(resize); observer.observe(surface); observer.observe(title);
  resize();
  return { resize, render, reset, dispose() {
    disposed = true; observer.disconnect(); wall.remove(); air.remove();
    replacements.forEach(({ text, marker, inserted }) => { inserted.forEach(n => n.remove()); marker.replaceWith(text); });
    if (originalLabel === null) title.removeAttribute('aria-label'); else title.setAttribute('aria-label', originalLabel);
  } };
}
