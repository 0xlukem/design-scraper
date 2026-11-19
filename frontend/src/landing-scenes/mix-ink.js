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
export function createMixInk({ banner, host, title = banner.querySelector('#mix-title') }) {
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
  const world = banner.querySelector('.mix-world') || banner;
  const pageScale = () => Math.max(1, Math.min(1.8, box.width / 1440));
  const titleTarget = (fraction, large = false) => ({ element: letters[Math.floor(fraction * (letters.length - 1))].node, u: .5, v: .5, title: true, large });
  const wallTarget = (element, u, v, large = false, offset = 0) => ({ element, u, v, large, offset });
  // The former fixed splashes now arrive as the first, heaviest paint loads.
  // Offscreen targets wait until their region enters the viewport.
  const openingTargets = () => workspace ? [
    ...(innerWidth > 2200 ? [
      { ...wallTarget(banner, 0, .14, true), pageX: .24, minWidth: 2201 },
      { ...wallTarget(banner, 0, .08, true), pageX: .72, minWidth: 2201 },
      { ...wallTarget(banner, 0, .45, true), pageX: .08, minWidth: 2201 },
      { ...wallTarget(banner, 0, .74, true), pageX: .91, minWidth: 2201 },
    ] : []),
    wallTarget(form, 0, .13, true, -12), titleTarget(.12, true),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .18, .22, true), minWidth: 901 }] : []),
    titleTarget(.53, true), wallTarget(form, 1, .45, true, 12),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .76, .21, true), minWidth: 901 }] : []),
    titleTarget(.88, true), wallTarget(form, 0, .76, true, -8),
    ...(innerWidth > 900 ? [{ ...wallTarget(world, .1, .7, true), minWidth: 901 }] : []),
    titleTarget(.32, true), wallTarget(world, .88, .65, true),
    ...(innerWidth > 1800 ? [{ ...wallTarget(form, 0, .28, true), pageX: .15, minWidth: 1801 }, { ...wallTarget(form, 0, .6, true), pageX: .85, minWidth: 1801 }] : []),
    ...(endBanner ? [wallTarget(endBanner, 0, .05, true, -35), wallTarget(endBanner, 1, .05, true, 35)] : []),
    ...(footer ? [wallTarget(footer, 1, .8, true, 25)] : []),
  ] : [];
  let pending = openingTargets();
  function targetPoint(target) {
    const bounds = relative(target.element.getBoundingClientRect());
    return { x: target.pageX === undefined ? bounds.x + bounds.width * target.u + (target.offset || 0) : target.pageX * box.width, y: bounds.y + bounds.height * target.v };
  }
  function isVisible(target) {
    const point = targetPoint(target), y = point.y + box.top;
    return y > 70 && y < innerHeight - 30;
  }
  function resize() {
    box = surface.getBoundingClientRect(); hostBox = host.getBoundingClientRect();
    for (const el of [wall, air]) el.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    for (const letter of letters) letter.box = relative(letter.node.getBoundingClientRect());
    // Existing stains remain anchored to their actual content across reflow.
    for (const patch of patches) positionPatch(patch);
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
    const index = pending.findIndex(isVisible);
    if (index >= 0) return pending.splice(index, 1)[0];
    if (isVisible(titleTarget(.5)) && i % 4 === 0) return titleTarget(random());
    // Distribute over the available surface, rather than drawing two edge rails.
    // Prefer unpainted gaps; text and the opaque center of the blender stay clear.
    const protect = [title, banner.querySelector('.analysis-description')].filter(Boolean).map(el => relative(el.getBoundingClientRect()));
    const model = relative(world.getBoundingClientRect());
    if (box.width > 900) protect.push({ x: model.x + model.width * .34, y: model.y + model.height * .25, width: model.width * .37, height: model.height * .71 });
    let best = null, bestDistance = -1;
    for (let attempt = 0; attempt < 18; attempt++) {
      const y = Math.max(100, Math.min(box.height - 70, -box.top + 120 + random() * Math.max(60, innerHeight - 240)));
      const lowerPage = endBanner && y > relative(endBanner.getBoundingClientRect()).y - 50;
      const side = lowerPage ? (i % 2 ? -30 / box.width : 1 + 30 / box.width) : box.width <= 900 ? (i % 2 ? .015 + random() * .045 : .94 + random() * .045) : .025 + random() * .95;
      const x = side * box.width, pad = 65 * pageScale();
      if (protect.some(b => overlaps({ x: x - pad, y: y - pad, width: pad * 2, height: pad * 2 + 100 * pageScale() }, b))) continue;
      const distance = Math.min(...patches.filter(p => !p.target.title).map(p => Math.hypot(x - p.x, y - p.y)), box.width);
      if (distance > bestDistance) { best = { y, side }; bestDistance = distance; }
    }
    const { y, side } = best || { y: -box.top + innerHeight * .65, side: i % 2 ? .02 : .98 };
    // Anchor deposits to their section, so adding results below the hero cannot
    // stretch or move already-settled paint elsewhere on the page.
    const sections = [banner, surface.querySelector('.analysis-results'), endBanner, footer].filter(Boolean);
    const section = sections.find(element => { const b = relative(element.getBoundingClientRect()); return y >= b.y && y <= b.y + b.height; }) || banner;
    const region = relative(section.getBoundingClientRect());
    return { ...wallTarget(section, 0, (y - region.y) / Math.max(1, region.height)), pageX: side };
  }
  function emit() {
    const id = serial++, target = chooseTarget(id), point = targetPoint(target);
    const duration = target.large ? .62 + random() * .16 : .7 + random() * .3;
    const color = COLORS[id % COLORS.length], g = 620;
    const group = node('g', { fill: color, 'data-load': target.large ? 'large' : 'small' });
    const size = (target.large ? 2.6 : 1) * (workspace ? pageScale() : 1);
    group.append(node('ellipse', { rx: 3.5 * size, ry: 9 * size }), node('ellipse', { cx: -.7 * size, cy: -2 * size, rx: .8 * size, ry: 3 * size, fill: '#fff', opacity: .55 }));
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
    const target = shot.target, radius = radiusFor(target);
    const fluid = new PaintFluid({ radius, gravity: target.title ? 65 : 260 * (workspace ? pageScale() : 1), dryAfter: target.title ? 2.3 : 5.2, seed: shot.id + 900 });
    fluid.impact({ vx: shot.vx, vy: shot.vy, count: !workspace ? (target.title ? 32 : 58) : target.large ? 72 : 42, spread: target.title ? .32 : .8 });
    const path = node('path', { fill: shot.color, 'data-load': target.large ? 'large' : 'small', 'data-region': target.title ? 'title' : target.element === endBanner ? 'banner' : target.element === footer ? 'footer' : 'page' });
    const patch = { fluid, path, radius, scale: 1, color: shot.color, target, lastD: '', id: shot.id };
    if (target.title) letterHits++;
    else { wallHits++; wall.append(path); }
    patches.push(patch); impacts++; positionPatch(patch);
    // Keep entrance loads; recycle only small later deposits. Bounded DOM/solvers.
    while (patches.length > Math.round(44 * (workspace ? pageScale() : 1))) {
      const index = patches.findIndex(p => !p.target.large && !p.fluid);
      if (index < 0) break;
      patches[index].path.remove(); patches.splice(index, 1);
    }
  }
  function positionPatch(patch) {
    Object.assign(patch, targetPoint(patch.target));
    patch.scale = radiusFor(patch.target) / patch.radius;
    patch.path.setAttribute('transform', `translate(${patch.x} ${patch.y}) scale(${patch.scale})`);
    const incompatible = patch.target.minWidth && box.width < patch.target.minWidth;
    // A stain that belonged in a wide-layout gap must not move over the headline
    // after reflow. Hide that whole deposit instead of clipping its silhouette.
    let readingOverlap = false;
    if (workspace && !patch.target.title && patch.bounds) {
      const paint = { x: patch.x + patch.bounds.x * patch.scale, y: patch.y + patch.bounds.y * patch.scale,
        width: (patch.bounds.right - patch.bounds.x) * patch.scale, height: (patch.bounds.bottom - patch.bounds.y) * patch.scale };
      readingOverlap = [title, banner.querySelector('.analysis-description')].filter(Boolean).some(el => overlaps(paint, relative(el.getBoundingClientRect())));
    }
    patch.path.style.visibility = incompatible || readingOverlap ? 'hidden' : '';

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
  function step() {
    clock += STEP;
    if (clock >= nextShot) {
      // Never launch more material while the previous impacts saturate the solver.
      if (patches.filter(p => p.fluid).length < 7) emit();
      nextShot = clock + (!workspace ? (serial < 6 ? .52 : 1.25) : pending.some(isVisible) ? .42 : 1.8 / pageScale());
    }
    for (const shot of shots) {
      shot.vy += shot.g * STEP; shot.x += shot.vx * STEP; shot.y += shot.vy * STEP; shot.z += shot.vz * STEP;
      if (shot.z <= 0) { collide(shot); shot.group.remove(); }
    }
    shots = shots.filter(shot => shot.z > 0);
    for (const patch of patches) patch.fluid?.step();
  }
  function draw() {
    for (const shot of shots) {
      const scale = .6 + (1 - shot.z / 120) * .75, angle = Math.atan2(shot.vy, shot.vx) * 180 / Math.PI - 90;
      shot.group.setAttribute('transform', `translate(${shot.x.toFixed(2)} ${shot.y.toFixed(2)}) rotate(${angle.toFixed(1)}) scale(${scale.toFixed(2)})`);
    }
    if (clock - lastPaint < 1 / 30) return;
    lastPaint = clock; let titleChanged = false;
    for (const patch of patches) if (patch.fluid) {
      patch.lastD = fluidPath(patch.fluid, Math.max(2, patch.fluid.radius * .65)); patch.bounds = patch.fluid.bounds();
      patch.path.setAttribute('d', patch.lastD);
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
    accumulator += Math.min(.08, Math.max(0, (ms - lastMs) / 1000)); lastMs = ms;
    while (accumulator >= STEP) { step(); accumulator -= STEP; }
    draw();
  }
  function reset() {
    shots.forEach(shot => shot.group.remove()); shots = []; patches = []; wall.replaceChildren();
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
